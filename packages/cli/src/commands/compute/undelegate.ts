/**
 * Undelegate command
 *
 * Undelegate account from the EIP7702 delegator
 */

import { Command } from "@oclif/core";
import { commonFlags } from "../../flags";
import { createAppClient } from "../../client";
import chalk from "chalk";

export default class Undelegate extends Command {
  static description = "Undelegate your account from the EIP7702 delegator";

  static flags = {
    ...commonFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Undelegate);
    const app = await createAppClient(flags);

    const res = await app.undelegate();

    if (!res.tx) {
      this.log(`\n${chalk.gray(`Undelegate aborted`)}`);
    } else {
      this.log(`\n✅ ${chalk.green(`Undelegated successfully`)}`);
    }
  }
}
