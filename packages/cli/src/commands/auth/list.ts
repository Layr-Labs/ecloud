/**
 * Auth List Command
 *
 * List stored private key (single key for all environments)
 */

import { Command } from "@oclif/core";
import { listStoredKeys } from "@ecloud/sdk";

export default class AuthList extends Command {
  static description = "List stored private key";

  static aliases = ["auth:ls"];

  static examples = ["<%= config.bin %> <%= command.id %>"];

  async run(): Promise<void> {
    // Get stored key
    const keys = await listStoredKeys();

    if (keys.length === 0) {
      this.log("No key stored in keyring");
      this.log("");
      this.log("To store a key, use:");
      this.log("  ecloud auth login");
      return;
    }

    // Display header
    this.log("Stored private key:");
    this.log("");

    // Display the key
    for (const { address } of keys) {
      this.log(`  Address: ${address}`);
    }

    // Show help text
    this.log("");
    this.log("Note: This key is used for all environments (mainnet, sepolia, etc.)");
    this.log("");
    this.log("Usage:");
    this.log("  ecloud auth login   # Store a new key");
    this.log("  ecloud auth logout  # Remove stored key");
  }
}
