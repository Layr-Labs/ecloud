import { Command } from "@oclif/core";
import { createAdminClient } from "../../../client";
import { commonFlags } from "../../../flags";
import chalk from "chalk";
import { withTelemetry } from "../../../telemetry";

export default class AdminAdminsList extends Command {
  static description = "List all admins";

  static examples = [
    "<%= config.bin %> admin admins list",
  ];

  static flags = {
    ...commonFlags,
  };

  async run() {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(AdminAdminsList);
      const admin = await createAdminClient(flags);

      const { admins } = await admin.listAdmins();

      if (admins.length === 0) {
        this.log("\n  No admins found.\n");
        return;
      }

      this.log(`\n${chalk.bold("Admins")} (${admins.length}):\n`);
      for (const a of admins) {
        this.log(`  ${chalk.cyan(a.address)}  ${chalk.gray(a.createdAt)}`);
      }
      this.log();
    });
  }
}
