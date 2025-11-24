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

  static examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> --environment sepolia",
  ];

  static flags = {
    environment: commonFlags.environment,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AuthLogin);
    const environment = flags.environment;

    // Check if key already exists
    const exists = await keyExists(environment);

    if (exists) {
      displayWarning([
        `WARNING: A private key for '${environment}' already exists!`,
        "Replacing it will cause PERMANENT DATA LOSS if not backed up.",
        "The previous key will be lost forever.",
      ]);

      const confirmReplace = await confirm({
        message: `Replace existing key for '${environment}'?`,
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
      message: `Store this key for '${environment}'?`,
      default: true,
    });

    if (!confirmStore) {
      this.log("\nLogin cancelled.");
      return;
    }

    // Store in keyring
    try {
      await storePrivateKey(environment, privateKey);
      this.log(`\n✓ Private key stored in OS keyring for '${environment}'`);
      this.log(`✓ Address: ${address}`);
      this.log("\nYou can now use ecloud commands without --private-key flag.");
    } catch (err: any) {
      this.error(`Failed to store key: ${err.message}`);
    }
  }
}
