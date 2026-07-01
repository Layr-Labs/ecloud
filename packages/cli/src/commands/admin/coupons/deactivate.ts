import { Args, Command } from "@oclif/core";
import { createAdminClient } from "../../../client";
import { commonFlags } from "../../../flags";
import chalk from "chalk";
import { withTelemetry } from "../../../telemetry";

export default class AdminCouponsDeactivate extends Command {
  static description = "Deactivate a coupon";

  static examples = [
    "<%= config.bin %> admin coupons deactivate <coupon-id>",
  ];

  static args = {
    id: Args.string({ description: "Coupon ID", required: true }),
  };

  static flags = {
    ...commonFlags,
  };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(AdminCouponsDeactivate);
      const admin = await createAdminClient(flags);

      await admin.deactivateCoupon(args.id);

      this.log(`\n  ${chalk.green("✓")} Coupon ${chalk.cyan(args.id)} deactivated.\n`);
    });
  }
}
