/**
 * Auth Login Command
 *
 * Store an existing private key in OS keyring
 */

import { Command } from "@oclif/core";
import { confirm, select } from "@inquirer/prompts";
import {
  storePrivateKey,
  keyExists,
  validatePrivateKey,
  getAddressFromPrivateKey,
  getLegacyKeys,
  getLegacyPrivateKey,
  deleteLegacyPrivateKey,
  type LegacyKey,
} from "@layr-labs/ecloud-sdk";
import { getHiddenInput, displayWarning } from "../../utils/security";

export default class AuthLogin extends Command {
  static description = "Store your private key in OS keyring";

  static examples = ["<%= config.bin %> <%= command.id %>"];

  async run(): Promise<void> {
    // Check if key already exists
    const exists = await keyExists();

    if (exists) {
      displayWarning([
        "WARNING: A private key for ecloud already exists!",
        "Replacing it will cause PERMANENT DATA LOSS if not backed up.",
        "The previous key will be lost forever.",
      ]);

      const confirmReplace = await confirm({
        message: "Replace existing key?",
        default: false,
      });

      if (!confirmReplace) {
        this.log("\nLogin cancelled.");
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

      // Display legacy keys
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
        // Create choices for selection
        const choices = legacyKeys.map((key) => ({
          name: `${key.address} (${key.environment} - ${key.source})`,
          value: key,
        }));

        selectedKey = await select<LegacyKey>({
          message: "Select a key to import:",
          choices,
        });

        // Retrieve the actual private key
        privateKey = await getLegacyPrivateKey(
          selectedKey.environment,
          selectedKey.source
        );

        if (!privateKey) {
          this.error(
            `Failed to retrieve legacy key for ${selectedKey.environment}`
          );
        }

        this.log(
          `\nImporting key from ${selectedKey.source}:${selectedKey.environment}`
        );
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

    // Derive address for confirmation
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

    // Store in keyring
    try {
      await storePrivateKey(privateKey);
      this.log("\n✓ Private key stored in OS keyring");
      this.log(`✓ Address: ${address}`);
      this.log(
        "\nNote: This key will be used for all environments (mainnet, sepolia, etc.)"
      );
      this.log("You can now use ecloud commands without --private-key flag.");

      // Ask if user wants to delete the legacy key (only if save was successful)
      if (selectedKey) {
        this.log("");
        const confirmDelete = await confirm({
          message: `Delete the legacy key from ${selectedKey.source}:${selectedKey.environment}?`,
          default: false,
        });

        if (confirmDelete) {
          const deleted = await deleteLegacyPrivateKey(
            selectedKey.environment,
            selectedKey.source
          );

          if (deleted) {
            this.log(
              `\n✓ Legacy key deleted from ${selectedKey.source}:${selectedKey.environment}`
            );
            this.log(
              "\nNote: The key is now only stored in ecloud. You can still use it with"
            );
            this.log(
              "eigenx-cli by providing --private-key flag or EIGENX_PRIVATE_KEY env var."
            );
          } else {
            this.log(
              `\n⚠️  Failed to delete legacy key from ${selectedKey.source}:${selectedKey.environment}`
            );
            this.log("The key may have already been removed.");
          }
        } else {
          this.log(
            `\nLegacy key kept in ${selectedKey.source}:${selectedKey.environment}`
          );
          this.log(
            "You can delete it later using 'eigenx auth logout' if needed."
          );
        }
      }
    } catch (err: any) {
      this.error(`Failed to store key: ${err.message}`);
    }
  }
}
