/**
 * Auth Whoami Command
 *
 * Show stored identities, active identity, and signing key status
 */

import { Command } from "@oclif/core";
import {
  getPrivateKeyWithSource,
  getAddressFromPrivateKey,
  getPendingTimelockOps,
  getEnvironmentConfig,
  type PendingTimelockOp,
} from "@layr-labs/ecloud-sdk";
import { commonFlags } from "../../flags";
import { withTelemetry } from "../../telemetry";
import { createViemClients } from "../../utils/viemClients";
import {
  getIdentities,
  getActiveIdentityAddress,
  formatIdentity,
  type StoredIdentity,
} from "../../utils/globalConfig";
import { formatCountdown } from "../../utils/format";
import chalk from "chalk";
import type { Address } from "viem";

export default class AuthWhoami extends Command {
  static description = "Show stored identities and current authentication status";

  static examples = ["<%= config.bin %> <%= command.id %>"];

  static flags = {
    environment: commonFlags.environment,
    "rpc-url": commonFlags["rpc-url"],
    verbose: commonFlags.verbose,
  };

  async run(): Promise<void> {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(AuthWhoami);
      const environment = flags.environment as string;
      const verbose = flags.verbose ?? false;

      // Signing key status
      const result = await getPrivateKeyWithSource({ privateKey: undefined });
      if (result) {
        const signingAddress = getAddressFromPrivateKey(result.key);
        this.log(`Signing key: ${signingAddress}  (${result.source})`);
      } else {
        this.log(`Signing key: none  (run: ecloud auth login)`);
      }

      this.log("");

      // Identities
      const identities = getIdentities();
      const activeAddress = getActiveIdentityAddress(environment);

      if (identities.length === 0) {
        this.log("Identities: none");
        this.log("");
        this.log("Run 'ecloud auth gen' to generate a new key, or 'ecloud auth login' to import an existing one.");
        return;
      }

      // Fetch pending ops for all Timelock identities in this environment
      const timelocks = identities.filter(
        (id) => id.type === "timelock" && id.environment === environment,
      );
      const pendingOpsMap = new Map<string, PendingTimelockOp[]>();

      if (timelocks.length > 0 && result) {
        const environmentConfig = getEnvironmentConfig(environment);
        const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;
        try {
          const { publicClient } = createViemClients({
            privateKey: result.key,
            rpcUrl,
            environment,
          });
          await Promise.all(
            timelocks.map(async (id) => {
              try {
                const ops = await getPendingTimelockOps(publicClient, id.address as Address);
                if (ops.length > 0) pendingOpsMap.set(id.address.toLowerCase(), ops);
              } catch (e: any) {
                this.warn(`Could not fetch pending ops for ${id.address}: ${e?.message ?? e}`);
              }
            }),
          );
        } catch {
          // silently skip pending ops if RPC unavailable
        }
      }

      this.log(`Identities (${environment}):`);
      for (const id of identities) {
        const isActive = id.address.toLowerCase() === activeAddress?.toLowerCase();
        const marker = isActive ? "●" : "○";
        const active = isActive ? "  ← active" : "";
        this.log(`  ${marker} ${formatIdentity(id, verbose)}${active}`);

        if (id.type === "timelock") {
          const ops = pendingOpsMap.get(id.address.toLowerCase()) ?? [];
          if (ops.length > 0) {
            for (const op of ops) {
              const now = BigInt(Math.floor(Date.now() / 1000));
              const status = op.ready
                ? chalk.green("ready to execute")
                : `executable in ${formatCountdown(op.executableAt - now)}`;
              this.log(`      ⏳ ${op.description}  [${status}]  id: ${verbose ? op.id : `${op.id.slice(0, 10)}…`}`);
            }
          }
        }
      }

      // If active identity is the EOA signing key itself (no contract identity active)
      if (result && activeAddress?.toLowerCase() === getAddressFromPrivateKey(result.key).toLowerCase()) {
        this.log(`\n  Active: signing key (EOA)`);
      }

      this.log("");
      if (!activeAddress) {
        this.log("No active identity. Run 'ecloud auth login' to select one.");
      } else {
        this.log("Run 'ecloud auth identity new' to create a Safe or Timelock identity.");
        this.log("Run 'ecloud auth identity select' to switch active identity.");
      }
    });
  }
}
