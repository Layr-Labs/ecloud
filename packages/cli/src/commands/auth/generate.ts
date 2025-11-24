/**
 * Auth Generate Command
 *
 * Generate a new private key and optionally store it in OS keyring
 */

import { Command, Flags } from "@oclif/core";
import { confirm } from "@inquirer/prompts";
import {
  generateNewPrivateKey,
  storePrivateKey,
  keyExists,
  showPrivateKey,
  displayWarning,
} from "@ecloud/sdk";
import { commonFlags } from "../../flags";

export default class AuthGenerate extends Command {
  static description = "Generate a new private key";

  static aliases = ["auth:gen", "auth:new"];

  static examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> --store",
    "<%= config.bin %> <%= command.id %> --environment sepolia --store",
  ];

  static flags = {
    environment: commonFlags.environment,
    store: Flags.boolean({
      description: "Automatically store in OS keyring",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AuthGenerate);

    // Generate new key
    this.log("Generating new private key...\n");
    const { privateKey, address } = generateNewPrivateKey();

    // Display key securely
    const content = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A new private key was generated for you.

IMPORTANT: You MUST backup this key now.
           It will never be shown again.

Address:     ${address}
Private key: ${privateKey}

⚠️  SECURITY WARNING:
   • Anyone with this key can control your account
   • Never share it or commit it to version control
   • Store it in a secure password manager
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

    const displayed = await showPrivateKey(content);

    if (!displayed) {
      this.log("Key generation cancelled.");
      return;
    }

    // Ask about storing
    let shouldStore = flags.store;

    if (!shouldStore && displayed) {
      shouldStore = await confirm({
        message: "Store this key in your OS keyring?",
        default: true,
      });
    }

    if (shouldStore) {
      const environment = flags.environment;

      // Check if key already exists
      const exists = await keyExists(environment);

      if (exists) {
        displayWarning([
          `WARNING: A private key for '${environment}' already exists!`,
          "If you continue, the existing key will be PERMANENTLY REPLACED.",
          "This cannot be undone!",
          "",
          "The previous key will be lost forever if you haven't backed it up.",
        ]);

        const confirmReplace = await confirm({
          message: `Replace existing key for '${environment}'?`,
          default: false,
        });

        if (!confirmReplace) {
          this.log("\nKey not stored. Your new key is shown above (if you saved it).");
          return;
        }
      }

      // Store the key
      try {
        await storePrivateKey(environment, privateKey);
        this.log(`\n✓ Private key stored in OS keyring for '${environment}'`);
        this.log(`✓ Address: ${address}`);
        this.log("\nYou can now use ecloud commands without --private-key flag.");
      } catch (err: any) {
        this.error(`Failed to store key: ${err.message}`);
      }
    } else {
      this.log("\nKey not stored in keyring.");
      this.log("Remember to save the key shown above in a secure location.");
    }
  }
}
