import { Args, Command } from "@oclif/core";
import { createAdminClient } from "../../../client";
import { commonFlags } from "../../../flags";
import chalk from "chalk";
import { withTelemetry } from "../../../telemetry";

export default class AdminAdminsAdd extends Command {
  static description = "Add a new admin";

  static examples = [
    "<%= config.bin %> admin admins add 0x...",
  ];

  static args = {
    address: Args.string({ description: "Wallet address to grant admin", required: true }),
  };

  static flags = {
    ...commonFlags,
  };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(AdminAdminsAdd);
      const admin = await createAdminClient(flags);

      const { admin: newAdmin } = await admin.addAdmin(args.address);

      this.log(`\n  ${chalk.green("✓")} Admin added`);
      this.log(`  Address: ${chalk.cyan(newAdmin.address)}`);
      this.log(`  ID:      ${newAdmin.id}\n`);
    });
  }
}
