/**
 * Auth Migrate Command
 *
 * Migrate a legacy eigenx-cli key to ecloud
 */

import { Command } from "@oclif/core";
import { confirm, select } from "@inquirer/prompts";
import {
  storePrivateKey,
  keyExists,
  getAddressFromPrivateKey,
  getLegacyKeys,
  getLegacyPrivateKey,
  deleteLegacyPrivateKey,
  type LegacyKey,
} from "@layr-labs/ecloud-sdk";
import { displayWarning } from "../../utils/security";
import { withTelemetry } from "../../telemetry";

export default class AuthMigrate extends Command {
  static description = "Migrate a private key from eigenx-cli to ecloud";

  static examples = ["<%= config.bin %> <%= command.id %>"];

  async run(): Promise<void> {
    return withTelemetry(this, async () => {
      const legacyKeys = await getLegacyKeys();

    if (legacyKeys.length === 0) {
      this.log("No legacy keys found from eigenx-cli.");
      this.log("");
      this.log("To manually add a key to ecloud, use:");
      this.log("  ecloud auth login");
      return;
    }

    // Display found legacy keys
    this.log("\nFound legacy keys from eigenx-cli:");
    this.log("");

    for (const key of legacyKeys) {
      this.log(`  Address: ${key.address}`);
      this.log(`  Environment: ${key.environment}`);
      this.log(`  Source: ${key.source}`);
      this.log("");
    }

    // Create choices for selection
    const choices = legacyKeys.map((key) => ({
      name: `${key.address} (${key.environment} - ${key.source})`,
      value: key,
    }));

    const selectedKey = await select<LegacyKey>({
      message: "Select a key to migrate:",
      choices,
    });

    // Retrieve the actual private key
    const privateKey = await getLegacyPrivateKey(selectedKey.environment, selectedKey.source);

    if (!privateKey) {
      this.error(`Failed to retrieve legacy key for ${selectedKey.environment}`);
    }

    // Derive address for display
    const address = getAddressFromPrivateKey(privateKey);
    this.log(`\nMigrating key: ${address}`);
    this.log(`From: ${selectedKey.source}:${selectedKey.environment}`);

    // Check if ecloud key already exists
    const exists = await keyExists();

    if (exists) {
      this.log("");
      displayWarning([
        "WARNING: A private key for ecloud already exists!",
        "Replacing it will cause PERMANENT DATA LOSS if not backed up.",
        "The previous key will be lost forever.",
      ]);

      const confirmReplace = await confirm({
        message: "Replace existing ecloud key?",
        default: false,
      });

      if (!confirmReplace) {
        this.log("\nMigration cancelled.");
        return;
      }
    }

    // Store in ecloud keyring
    try {
      await storePrivateKey(privateKey);
      this.log("\n✓ Private key migrated to ecloud keyring");
      this.log(`✓ Address: ${address}`);
      this.log("\nNote: This key will be used for all environments (mainnet, sepolia, etc.)");

      // Ask if user wants to delete the legacy key (only if save was successful)
      this.log("");
      const confirmDelete = await confirm({
        message: `Delete the legacy key from ${selectedKey.source}:${selectedKey.environment}?`,
        default: false,
      });

      if (confirmDelete) {
        const deleted = await deleteLegacyPrivateKey(selectedKey.environment, selectedKey.source);

        if (deleted) {
          this.log(`\n✓ Legacy key deleted from ${selectedKey.source}:${selectedKey.environment}`);
          this.log("\nNote: The key is now only stored in ecloud. You can still use it with");
          this.log("eigenx-cli by providing --private-key flag or EIGENX_PRIVATE_KEY env var.");
        } else {
          this.log(
            `\n⚠️  Failed to delete legacy key from ${selectedKey.source}:${selectedKey.environment}`,
          );
          this.log("The key may have already been removed.");
        }
      } else {
        this.log(`\nLegacy key kept in ${selectedKey.source}:${selectedKey.environment}`);
        this.log("You can delete it later using 'eigenx auth logout' if needed.");
      }

      this.log("");
      this.log("Migration complete! You can now use ecloud commands without --private-key flag.");
    } catch (err: any) {
      this.error(`Failed to migrate key: ${err.message}`);
    }
    });
  }
}
