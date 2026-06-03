/**
 * Auth Sync Command
 *
 * Rescans the chain for Safes and Timelocks deployed by the current signing key
 * and rebuilds the identities list in config.
 */

import { Command } from "@oclif/core";
import {
  keyExists,
  getPrivateKeyWithSource,
  getAddressFromPrivateKey,
  getEnvironmentConfig,
  getTimelocksByDeployer,
  getSafesByDeployer,
} from "@layr-labs/ecloud-sdk";
import { withTelemetry } from "../../telemetry";
import { commonFlags } from "../../flags";
import {
  replaceAllIdentities,
  setActiveIdentity,
  addIdentity,
} from "../../utils/globalConfig";
import { createPublicClientOnly } from "../../utils/viemClients";
import { fetchSafeInfo, fetchTimelockDelay, isTimelockProposer } from "../../utils/contractAbis";
import type { Address } from "viem";

export default class AuthSync extends Command {
  static description = "Rescan chain and rebuild identities for the current signing key";

  static examples = ["<%= config.bin %> <%= command.id %>"];

  static flags = {
    environment: commonFlags.environment,
    "rpc-url": commonFlags["rpc-url"],
  };

  async run(): Promise<void> {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(AuthSync);
      const environment = flags.environment as string;

      const existing = await keyExists();
      if (!existing) {
        this.error("No signing key found. Run 'ecloud auth generate' or 'ecloud auth login' first.");
      }

      const result = await getPrivateKeyWithSource({ privateKey: undefined });
      if (!result) {
        this.error("Failed to read signing key.");
      }

      const address = getAddressFromPrivateKey(result.key) as Address;
      this.log(`Signing key: ${address}`);
      this.log(`Scanning ${environment} for associated identities...\n`);

      const publicClient = createPublicClientOnly({ environment, rpcUrl: flags["rpc-url"] });
      const environmentConfig = getEnvironmentConfig(environment);

      const [safes, directTimelocks] = await Promise.all([
        getSafesByDeployer(publicClient, environmentConfig, address),
        getTimelocksByDeployer(publicClient, environmentConfig, address),
      ]);

      const safeTimelockArrays = await Promise.all(
        safes.map((safe) => getTimelocksByDeployer(publicClient, environmentConfig, safe as Address)),
      );
      const safeTimelocks = safeTimelockArrays.flat();

      // Rebuild identities from scratch
      replaceAllIdentities([{ type: "eoa", address }]);
      setActiveIdentity(environment, address);

      for (const safe of safes) {
        const { threshold, owners } = await fetchSafeInfo(publicClient, safe as Address);
        addIdentity({ type: "safe", address: safe, environment, threshold, owners });
        this.log(`✓ Safe:     ${safe}`);
      }

      // Combine all timelocks and resolve their actual proposer by checking hasRole
      const allTimelocks = [
        ...directTimelocks,
        ...safeTimelocks.filter((t) => !directTimelocks.some((d) => d.toLowerCase() === t.toLowerCase())),
      ];

      for (const timelock of allTimelocks) {
        const delay = await fetchTimelockDelay(publicClient, timelock as Address);
        // Check if any known Safe is a proposer on this Timelock
        const safeProposer = safes.length > 0
          ? await (async () => {
              for (const safe of safes) {
                if (await isTimelockProposer(publicClient, timelock as Address, safe as Address)) return safe;
              }
              return undefined;
            })()
          : undefined;
        addIdentity({ type: "timelock", address: timelock, delay, safeAddress: safeProposer, environment });
        if (safeProposer) {
          this.log(`✓ Timelock: ${timelock}  (via Safe ${safeProposer}, delay: ${delay})`);
        } else {
          this.log(`✓ Timelock: ${timelock}  (via EOA, delay: ${delay})`);
        }
      }

      const total = safes.length + allTimelocks.length;
      if (total === 0) {
        this.log(`No factory-deployed identities found on ${environment}.`);
      } else {
        this.log(`\n✓ Synced ${total} identit${total === 1 ? "y" : "ies"}.`);
      }

      this.log(`\nRun 'ecloud auth identity select' to set an active identity.`);
    });
  }
}
