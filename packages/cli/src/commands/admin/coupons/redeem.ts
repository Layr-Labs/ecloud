import { Args, Command, Flags } from "@oclif/core";
import { createAdminClient } from "../../../client";
import { commonFlags } from "../../../flags";
import chalk from "chalk";
import { withTelemetry } from "../../../telemetry";

export default class AdminCouponsRedeem extends Command {
  static description = "Redeem a coupon for a user (admin action)";

  static examples = [
    "<%= config.bin %> admin coupons redeem <coupon-id> --address 0x...",
  ];

  static args = {
    id: Args.string({ description: "Coupon ID", required: true }),
  };

  static flags = {
    ...commonFlags,
    address: Flags.string({
      required: true,
      description: "User wallet address to redeem coupon for",
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(AdminCouponsRedeem);
      const admin = await createAdminClient(flags);

      await admin.redeemCouponForUser(args.id, flags.address);

      this.log(`\n  ${chalk.green("✓")} Coupon ${chalk.cyan(args.id)} redeemed for ${chalk.cyan(flags.address)}.\n`);
    });
  }
}
