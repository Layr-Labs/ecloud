/**
 * Auth List Command
 *
 * List all stored private keys by environment
 */

import { Command } from "@oclif/core";
import { listStoredKeys } from "@ecloud/sdk";

export default class AuthList extends Command {
  static description = "List all stored private keys by environment";

  static aliases = ["auth:ls"];

  static examples = ["<%= config.bin %> <%= command.id %>"];

  async run(): Promise<void> {
    // Get all stored keys
    const keys = await listStoredKeys();

    if (keys.size === 0) {
      this.log("No keys stored in keyring");
      this.log("");
      this.log("To store a key, use:");
      this.log("  ecloud auth login");
      return;
    }

    // Sort keys by environment name for consistent output
    const sortedEntries = Array.from(keys.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );

    // Display header
    this.log("Stored private keys:");
    this.log("");

    // Display each key
    for (const [environment, address] of sortedEntries) {
      this.log(`  ${environment.padEnd(15)} ${address}`);
    }

    // Show help text
    this.log("");
    this.log("Usage:");
    this.log(
      "  ecloud auth login                    # Store key for current environment",
    );
    this.log(
      "  ecloud auth logout                   # Remove key for current environment",
    );
    this.log(
      "  ecloud --environment <env> <command> # Use different environment",
    );
  }
}
