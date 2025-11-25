/**
 * Auth Logout Command
 *
 * Remove private key from OS keyring
 */

import { Command, Flags } from "@oclif/core";
import { confirm } from "@inquirer/prompts";
import {
  deletePrivateKey,
  getPrivateKey,
  getAddressFromPrivateKey,
} from "@ecloud/sdk";

export default class AuthLogout extends Command {
  static description = "Remove private key from OS keyring";

  static examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> --force",
  ];

  static flags = {
    force: Flags.boolean({
      description: "Skip confirmation prompt",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AuthLogout);

    // Check if key exists
    const privateKey = await getPrivateKey();

    if (!privateKey) {
      this.log("No key found in keyring");
      this.log("\nNothing to remove.");
      return;
    }

    // Show address
    const address = getAddressFromPrivateKey(privateKey);
    this.log("Found stored key:");
    this.log(`  Address: ${address}`);
    this.log("");

    // Confirm unless forced
    if (!flags.force) {
      const confirmed = await confirm({
        message: "Remove private key from keyring?",
        default: false,
      });

      if (!confirmed) {
        this.log("Logout cancelled");
        return;
      }
    }

    // Remove from keyring
    try {
      const deleted = await deletePrivateKey();

      if (deleted) {
        this.log("\n✓ Successfully removed key from keyring");
        this.log(
          "\nYou will need to provide --private-key flag for future commands,"
        );
        this.log("or run 'ecloud auth login' to store a key again.");
      } else {
        this.log("\nFailed to remove key (it may have already been removed)");
      }
    } catch (err: any) {
      this.error(`Failed to remove key: ${err.message}`);
    }
  }
}
