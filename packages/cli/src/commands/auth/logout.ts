/**
 * Auth Logout Command
 *
 * Remove private key from OS keyring
 */

import { Command, Flags } from "@oclif/core";
import { confirm } from "@inquirer/prompts";
import { deletePrivateKey, getPrivateKey, getAddressFromPrivateKey } from "@layr-labs/ecloud-sdk";
import { withTelemetry } from "../../telemetry";
import { replaceAllIdentities } from "../../utils/globalConfig";

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
    return withTelemetry(this, async () => {
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
          replaceAllIdentities([]);
          this.log("\n✓ Signing key removed from keyring");
          this.log("✓ All identities cleared");
          this.log("\nRun 'ecloud auth generate' or 'ecloud auth login' to set up again.");
        } else {
          this.log("\nFailed to remove key (it may have already been removed)");
        }
      } catch (err: any) {
        this.error(`Failed to remove key: ${err.message}`);
      }
    });
  }
}
