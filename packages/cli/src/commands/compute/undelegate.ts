/**
 * Undelegate command
 *
 * Undelegate account from the EIP7702 delegator
 */

import { Command } from "@oclif/core";
import { commonFlags } from "../../flags";
import { createComputeClient } from "../../client";
import chalk from "chalk";
import { withTelemetry } from "../../telemetry";

export default class Undelegate extends Command {
  static description = "Undelegate your account from the EIP7702 delegator";

  static flags = {
    ...commonFlags,
  };

  async run(): Promise<void> {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(Undelegate);
      const compute = await createComputeClient(flags);

      // Check if account is currently delegated
      const isDelegated = await compute.app.isDelegated();
      if (!isDelegated) {
        this.log(`\n${chalk.gray(`Account is not currently delegated`)}`);
        return;
      }

      const res = await compute.app.undelegate();

      if (!res.tx) {
        this.log(`\n${chalk.gray(`Undelegate aborted`)}`);
      } else {
        this.log(`\n✅ ${chalk.green(`Undelegated successfully`)}`);
      }
    });
  }
}
