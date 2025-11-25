/**
 * Auth Login Command
 *
 * Store an existing private key in OS keyring
 */

import { Command } from "@oclif/core";
import { confirm } from "@inquirer/prompts";
import {
  storePrivateKey,
  keyExists,
  getHiddenInput,
  validatePrivateKey,
  getAddressFromPrivateKey,
  displayWarning,
} from "@ecloud/sdk";
import { commonFlags } from "../../flags";

export default class AuthLogin extends Command {
  static description = "Store your private key in OS keyring";

  static examples = ["<%= config.bin %> <%= command.id %>"];

  async run(): Promise<void> {
    // Check if key already exists
    const exists = await keyExists();

    if (exists) {
      displayWarning([
        "WARNING: A private key already exists!",
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

    // Prompt for private key (hidden input)
    let privateKey = await getHiddenInput("Enter your private key:");

    // Trim whitespace
    privateKey = privateKey.trim();

    // Validate format
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
    } catch (err: any) {
      this.error(`Failed to store key: ${err.message}`);
    }
  }
}
