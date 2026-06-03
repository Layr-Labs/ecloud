/**
 * Auth Identity Select Command
 *
 * Switch active identity for an environment.
 */

import { Command } from "@oclif/core";
import { select } from "@inquirer/prompts";
import { withTelemetry } from "../../../telemetry";
import { commonFlags } from "../../../flags";
import {
  getIdentities,
  getActiveIdentityAddress,
  setActiveIdentity,
  formatIdentity,
} from "../../../utils/globalConfig";

export default class AuthIdentitySelect extends Command {
  static description = "Switch active identity for an environment";

  static aliases = ["auth:identity:switch"];

  static examples = ["<%= config.bin %> <%= command.id %>"];

  static flags = {
    environment: commonFlags.environment,
  };

  async run(): Promise<void> {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(AuthIdentitySelect);
      const environment = flags.environment as string;

      const identities = getIdentities();

      if (identities.length === 0) {
        this.log("No identities.");
        this.log("\nRun 'ecloud auth identity new' to create one.");
        return;
      }

      const activeAddress = getActiveIdentityAddress(environment);

      const choices = identities.map((id) => ({
        name: formatIdentity(id) + (id.address.toLowerCase() === activeAddress?.toLowerCase() ? "  ✓ active" : ""),
        value: id.address,
      }));

      const selected = await select({
        message: `Select active identity for ${environment}:`,
        choices,
      });

      setActiveIdentity(environment, selected);
      const id = identities.find((i) => i.address.toLowerCase() === selected.toLowerCase())!;
      this.log(`\n✓ Active identity: ${formatIdentity(id)}`);
    });
  }
}
