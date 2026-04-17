/**
 * Auth Whoami Command
 *
 * Show stored identities, active identity, and signing key status
 */

import { Command } from "@oclif/core";
import { getPrivateKeyWithSource, getAddressFromPrivateKey } from "@layr-labs/ecloud-sdk";
import { commonFlags } from "../../flags";
import { withTelemetry } from "../../telemetry";
import {
  getIdentities,
  getActiveIdentityAddress,
  formatIdentity,
} from "../../utils/globalConfig";

export default class AuthWhoami extends Command {
  static description = "Show stored identities and current authentication status";

  static examples = ["<%= config.bin %> <%= command.id %>"];

  static flags = {
    environment: commonFlags.environment,
    verbose: commonFlags.verbose,
  };

  async run(): Promise<void> {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(AuthWhoami);
      const environment = flags.environment as string;
      const verbose = flags.verbose ?? false;

      // Signing key status
      const result = await getPrivateKeyWithSource({ privateKey: undefined });
      if (result) {
        const signingAddress = getAddressFromPrivateKey(result.key);
        this.log(`Signing key: ${signingAddress}  (${result.source})`);
      } else {
        this.log(`Signing key: none  (run: ecloud auth login)`);
      }

      this.log("");

      // Identities
      const identities = getIdentities();
      const activeAddress = getActiveIdentityAddress(environment);

      if (identities.length === 0) {
        this.log("Identities: none");
        this.log("");
        this.log("Run 'ecloud auth gen' to generate a new key, or 'ecloud auth login' to import an existing one.");
        return;
      }

      this.log(`Identities (${environment}):`);
      for (const id of identities) {
        const isActive = id.address.toLowerCase() === activeAddress?.toLowerCase();
        const marker = isActive ? "●" : "○";
        const active = isActive ? "  ← active" : "";
        this.log(`  ${marker} ${formatIdentity(id, verbose)}${active}`);
      }

      // If active identity is the EOA signing key itself (no contract identity active)
      if (result && activeAddress?.toLowerCase() === getAddressFromPrivateKey(result.key).toLowerCase()) {
        this.log(`\n  Active: signing key (EOA)`);
      }

      this.log("");
      if (!activeAddress) {
        this.log("No active identity. Run 'ecloud auth login' to select one.");
      } else {
        this.log("Run 'ecloud auth identity new' to create a Safe or Timelock identity.");
      this.log("Run 'ecloud auth identity select' to switch active identity.");
      }
    });
  }
}
