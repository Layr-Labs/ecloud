import { Args, Command } from "@oclif/core";
import { createAdminClient } from "../../../client";
import { commonFlags } from "../../../flags";
import chalk from "chalk";
import { withTelemetry } from "../../../telemetry";

export default class AdminCouponsGet extends Command {
  static description = "Get details of a coupon";

  static examples = [
    "<%= config.bin %> admin coupons get <coupon-id>",
  ];

  static args = {
    id: Args.string({ description: "Coupon ID", required: true }),
  };

  static flags = {
    ...commonFlags,
  };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(AdminCouponsGet);
      const admin = await createAdminClient(flags);

      const { coupon } = await admin.getCoupon(args.id);

      this.log(`\n${chalk.bold("Coupon Details:")}`);
      this.log(`  ID:         ${chalk.cyan(coupon.id)}`);
      this.log(`  Value:      ${chalk.cyan(`$${(coupon.amountCents / 100).toFixed(2)}`)}`);
      this.log(`  Active:     ${coupon.active ? chalk.green("yes") : chalk.red("no")}`);
      this.log(`  Created by: ${coupon.createdBy}`);
      this.log(`  Created at: ${coupon.createdAt}`);
      if (coupon.redeemedBy) {
        this.log(`  Redeemed by: ${coupon.redeemedBy}`);
        this.log(`  Redeemed at: ${coupon.redeemedAt}`);
      }
      this.log();
    });
  }
}
