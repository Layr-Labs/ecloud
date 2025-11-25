/**
 * Auth Whoami Command
 *
 * Show current authentication status and address
 */

import { Command } from "@oclif/core";
import {
  getPrivateKeyWithSource,
  getAddressFromPrivateKey,
  getPrivateKey,
} from "@ecloud/sdk";
import { commonFlags } from "../../flags";

export default class AuthWhoami extends Command {
  static description = "Show current authentication status and address";

  static examples = ["<%= config.bin %> <%= command.id %>"];

  static flags = {
    "private-key": {
      ...commonFlags["private-key"],
      required: false, // Make optional for whoami
    },
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AuthWhoami);

    // Try to get private key from any source
    const result = await getPrivateKeyWithSource({
      privateKey: flags["private-key"],
    });

    if (!result) {
      this.log("Not authenticated");
      this.log("");
      this.log("To authenticate, use one of:");
      this.log("  ecloud auth login                    # Store key in keyring");
      this.log(
        "  export ECLOUD_PRIVATE_KEY=0x...      # Use environment variable"
      );
      this.log("  ecloud <command> --private-key 0x... # Use flag");
      return;
    }

    // Get address from private key
    const address = getAddressFromPrivateKey(result.key);

    // Display authentication info
    this.log(`Address: ${address}`);
    this.log(`Source:  ${result.source}`);
    this.log("");
    this.log(
      "Note: This key is used for all environments (mainnet, sepolia, etc.)"
    );
  }
}
