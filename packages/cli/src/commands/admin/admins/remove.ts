import { Args, Command } from "@oclif/core";
import { createAdminClient } from "../../../client";
import { commonFlags } from "../../../flags";
import chalk from "chalk";
import { withTelemetry } from "../../../telemetry";

export default class AdminAdminsRemove extends Command {
  static description = "Remove an admin";

  static examples = [
    "<%= config.bin %> admin admins remove 0x...",
  ];

  static args = {
    address: Args.string({ description: "Wallet address to remove from admins", required: true }),
  };

  static flags = {
    ...commonFlags,
  };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(AdminAdminsRemove);
      const admin = await createAdminClient(flags);

      await admin.removeAdmin(args.address);

      this.log(`\n  ${chalk.green("✓")} Admin ${chalk.cyan(args.address)} removed.\n`);
    });
  }
}
