/**
 * Auth Identity List Command
 *
 * Show all stored identities and which is active.
 */

import { Command } from "@oclif/core";
import { withTelemetry } from "../../../telemetry";
import { commonFlags } from "../../../flags";
import {
  getIdentities,
  getActiveIdentityAddress,
  formatIdentity,
} from "../../../utils/globalConfig";

export default class AuthIdentityList extends Command {
  static description = "Show all stored identities";

  static aliases = ["auth:identity:ls"];

  static examples = ["<%= config.bin %> <%= command.id %>"];

  static flags = {
    environment: commonFlags.environment,
  };

  async run(): Promise<void> {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(AuthIdentityList);
      const environment = flags.environment as string;

      const identities = getIdentities();
      const activeAddress = getActiveIdentityAddress(environment);

      if (identities.length === 0) {
        this.log("No identities.");
        this.log("\nRun 'ecloud auth identity new' to create one.");
        return;
      }

      this.log(`Identities (${environment}):\n`);
      for (const id of identities) {
        const isActive = id.address.toLowerCase() === activeAddress?.toLowerCase();
        const marker = isActive ? "●" : "○";
        const active = isActive ? "  ← active" : "";
        this.log(`  ${marker} ${formatIdentity(id)}${active}`);
      }

      this.log("");
      this.log("Run 'ecloud auth identity select' to switch active identity.");
    });
  }
}
