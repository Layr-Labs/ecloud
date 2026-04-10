/**
 * Auth Generate Command
 *
 * Generate a new private key and optionally store it in OS keyring.
 * This only manages the signing key — use `auth identity new` to create identities.
 */

import { Command, Flags } from "@oclif/core";
import { confirm } from "@inquirer/prompts";
import {
  generateNewPrivateKey,
  storePrivateKey,
  keyExists,
  getPrivateKeyWithSource,
  getAddressFromPrivateKey,
} from "@layr-labs/ecloud-sdk";
import { showPrivateKey, displayWarning } from "../../utils/security";
import { withTelemetry } from "../../telemetry";
import { replaceAllIdentities, setActiveIdentity } from "../../utils/globalConfig";

export default class AuthGenerate extends Command {
  static description = "Generate a new private key and store in OS keyring";

  static aliases = ["auth:gen"];

  static examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> --store",
  ];

  static flags = {
    store: Flags.boolean({
      description: "Automatically store in OS keyring (skip prompt)",
      default: false,
    }),
  };

  async run(): Promise<void> {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(AuthGenerate);

      let shouldStore = flags.store;
      if (!shouldStore) {
        shouldStore = await confirm({ message: "Store this key in your OS keyring?", default: true });
      }

      // Check for existing key BEFORE generating a new one
      if (shouldStore) {
        const exists = await keyExists();
        if (exists) {
          const existing = await getPrivateKeyWithSource({ privateKey: undefined });
          if (existing) {
            const existingAddress = getAddressFromPrivateKey(existing.key);
            displayWarning([
              "A signing key already exists.",
              `Address: ${existingAddress}`,
              "",
              "Replacing it will clear all current identities.",
            ]);
          }
          const confirmReplace = await confirm({ message: "Replace existing key?", default: false });
          if (!confirmReplace) {
            this.log("\nCancelled.");
            return;
          }
        }
      }

      // Generate the new key
      const { privateKey, address } = generateNewPrivateKey();

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

Press 'q' to exit and continue...
`;

      const displayed = await showPrivateKey(content);
      if (!displayed) {
        this.log("Key generation cancelled.");
        return;
      }

      if (shouldStore) {
        try {
          await storePrivateKey(privateKey);
          // New signing key — wipe all identities (they belonged to the previous key)
          replaceAllIdentities([{ type: "eoa", address }]);
          for (const env of ["sepolia", "sepolia-dev", "mainnet-alpha"]) {
            setActiveIdentity(env, address);
          }
          this.log(`\n✓ Private key stored in OS keyring`);
          this.log(`✓ Address: ${address}`);
          this.log("\nYou can now use ecloud commands without --private-key flag.");
          this.log("Run 'ecloud auth identity new' to create a Safe or Timelock identity.");
        } catch (err: any) {
          this.error(`Failed to store key: ${err.message}`);
        }
      } else {
        this.log("\nKey not stored in keyring.");
        this.log("Remember to save the key shown above in a secure location.");
      }
    });
  }
}
