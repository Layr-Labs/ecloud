/**
 * Auth Login Command
 *
 * Import an existing private key into OS keyring.
 * Automatically discovers associated Timelocks and Safes on-chain.
 */

import { Command } from "@oclif/core";
import { confirm, select } from "@inquirer/prompts";
import {
  storePrivateKey,
  keyExists,
  validatePrivateKey,
  getAddressFromPrivateKey,
  getPrivateKeyWithSource,
  getLegacyKeys,
  getLegacyPrivateKey,
  deleteLegacyPrivateKey,
  getEnvironmentConfig,
  getTimelocksByDeployer,
  getSafesByDeployer,
  type LegacyKey,
} from "@layr-labs/ecloud-sdk";
import { getHiddenInput, displayWarning } from "../../utils/security";
import { withTelemetry } from "../../telemetry";
import { commonFlags } from "../../flags";
import {
  getIdentities,
  addIdentity,
  replaceAllIdentities,
  setActiveIdentity,
} from "../../utils/globalConfig";
import { createPublicClientOnly } from "../../utils/viemClients";
import type { Address } from "viem";

export default class AuthLogin extends Command {
  static description = "Import an existing private key into OS keyring";

  static examples = ["<%= config.bin %> <%= command.id %>"];

  static flags = {
    environment: commonFlags.environment,
    "rpc-url": commonFlags["rpc-url"],
  };

  async run(): Promise<void> {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(AuthLogin);
      const environment = flags.environment as string;

      // Check for existing key
      const exists = await keyExists();
      if (exists) {
        const existing = await getPrivateKeyWithSource({ privateKey: undefined });
        if (existing) {
          const existingAddress = getAddressFromPrivateKey(existing.key);
          displayWarning([
            "A signing key already exists.",
            `Address: ${existingAddress}`,
            "",
            "Replacing it will clear all current identities.",
          ]);
        }
        const confirmReplace = await confirm({ message: "Replace current signing key?", default: false });
        if (!confirmReplace) {
          this.log("\nCancelled.");
          return;
        }
      }

      // Check for legacy keys from eigenx-cli
      const legacyKeys = await getLegacyKeys();
      let privateKey: string | null = null;
      let selectedKey: LegacyKey | null = null;

      if (legacyKeys.length > 0) {
        this.log("\nFound legacy keys from eigenx-cli:");
        this.log("");

        for (const key of legacyKeys) {
          this.log(`  Address: ${key.address}`);
          this.log(`  Environment: ${key.environment}`);
          this.log(`  Source: ${key.source}`);
          this.log("");
        }

        const importLegacy = await confirm({
          message: "Would you like to import one of these legacy keys?",
          default: false,
        });

        if (importLegacy) {
          const choices = legacyKeys.map((key) => ({
            name: `${key.address} (${key.environment} - ${key.source})`,
            value: key,
          }));

          selectedKey = await select<LegacyKey>({
            message: "Select a key to import:",
            choices,
          });

          privateKey = await getLegacyPrivateKey(selectedKey.environment, selectedKey.source);

          if (!privateKey) {
            this.error(`Failed to retrieve legacy key for ${selectedKey.environment}`);
          }

          this.log(`\nImporting key from ${selectedKey.source}:${selectedKey.environment}`);
        }
      }

      // If no legacy key was selected, prompt for private key input
      if (!privateKey) {
        privateKey = await getHiddenInput("Enter your private key:");
        privateKey = privateKey.trim();
      }

      if (!validatePrivateKey(privateKey)) {
        this.error("Invalid private key format. Please check and try again.");
      }

      const address = getAddressFromPrivateKey(privateKey);
      this.log(`\nAddress: ${address}`);

      const confirmStore = await confirm({
        message: "Store this key in OS keyring?",
        default: true,
      });

      if (!confirmStore) {
        this.log("\nLogin cancelled.");
        return;
      }

      try {
        await storePrivateKey(privateKey);
        this.log("\n✓ Private key stored in OS keyring");
        this.log(`✓ Address: ${address}`);

        // New signing key — wipe old identities, set EOA as default
        replaceAllIdentities([{ type: "eoa", address }]);
        setActiveIdentity(environment, address);

        // Discover all Safes and Timelocks deployed by this EOA via SafeTimelockFactory.
        // Discovery order:
        //   1. Safes deployed by EOA
        //   2. Timelocks deployed by EOA directly (EOA → Timelock)
        //   3. Timelocks deployed by each Safe (Safe → Timelock)
        this.log(`\nScanning chain for associated identities...`);
        try {
          const publicClient = createPublicClientOnly({ environment, rpcUrl: flags["rpc-url"] });
          const environmentConfig = getEnvironmentConfig(environment);

          // Step 1 + 2: fetch Safes and direct Timelocks in parallel
          const [safes, directTimelocks] = await Promise.all([
            getSafesByDeployer(publicClient, environmentConfig, address as Address),
            getTimelocksByDeployer(publicClient, environmentConfig, address as Address),
          ]);

          // Step 3: for each Safe, fetch Timelocks it deployed
          const safeTimelockArrays = await Promise.all(
            safes.map((safe) => getTimelocksByDeployer(publicClient, environmentConfig, safe as Address)),
          );
          const safeTimelocks = safeTimelockArrays.flat();

          if (safes.length === 0 && directTimelocks.length === 0) {
            this.log(`No factory-deployed identities found for this EOA on ${environment}`);
          }

          for (const safe of safes) {
            const alreadyKnown = getIdentities().some(
              (id) => id.address.toLowerCase() === safe.toLowerCase(),
            );
            if (alreadyKnown) {
              this.log(`Safe ${safe}  (already in identities)`);
            } else {
              this.log(`Found Safe: ${safe}`);
              const addIt = await confirm({ message: `Add this Safe to your identities?`, default: true });
              if (addIt) {
                addIdentity({ type: "safe", address: safe, environment });
                this.log(`✓ Safe added to identities`);
              }
            }
          }

          // Timelocks: direct (EOA → Timelock) first, then Safe-deployed (Safe → Timelock)
          for (const timelock of directTimelocks) {
            const alreadyKnown = getIdentities().some(
              (id) => id.address.toLowerCase() === timelock.toLowerCase(),
            );
            if (alreadyKnown) {
              this.log(`Timelock ${timelock}  (already in identities)`);
            } else {
              this.log(`Found Timelock: ${timelock}`);
              const addIt = await confirm({ message: `Add this Timelock to your identities?`, default: true });
              if (addIt) {
                addIdentity({ type: "timelock", address: timelock, environment });
                this.log(`✓ Timelock added to identities`);
              }
            }
          }

          for (const timelock of safeTimelocks) {
            const safe = safes.find((s) =>
              safeTimelockArrays[safes.indexOf(s)]?.some((t) => t.toLowerCase() === timelock.toLowerCase()),
            );
            const alreadyKnown = getIdentities().some(
              (id) => id.address.toLowerCase() === timelock.toLowerCase(),
            );
            if (alreadyKnown) {
              this.log(`Timelock ${timelock}  (already in identities)`);
            } else {
              this.log(`Found Timelock: ${timelock}${safe ? ` (deployed by Safe ${safe})` : ""}`);
              const addIt = await confirm({ message: `Add this Timelock to your identities?`, default: true });
              if (addIt) {
                addIdentity({ type: "timelock", address: timelock, safeAddress: safe, environment });
                this.log(`✓ Timelock added to identities`);
              }
            }
          }
        } catch {
          this.log(`(Identity scan skipped — chain not reachable)`);
        }

        // Clean up legacy key if imported
        if (selectedKey) {
          this.log("");
          const confirmDelete = await confirm({
            message: `Delete the legacy key from ${selectedKey.source}:${selectedKey.environment}?`,
            default: false,
          });

          if (confirmDelete) {
            const deleted = await deleteLegacyPrivateKey(selectedKey.environment, selectedKey.source);
            if (deleted) {
              this.log(`\n✓ Legacy key deleted from ${selectedKey.source}:${selectedKey.environment}`);
            } else {
              this.log(`\n⚠️  Failed to delete legacy key`);
            }
          }
        }

        this.log("\nRun 'ecloud auth identity new' to create a Safe or Timelock identity.");
        this.log("Run 'ecloud auth identity select' to switch active identity.");
      } catch (err: any) {
        this.error(`Failed to store key: ${err.message}`);
      }
    });
  }
}
