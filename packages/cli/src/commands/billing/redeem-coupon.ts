import { Command, Flags } from "@oclif/core";
import { createBillingClient } from "../../client";
import { commonFlags } from "../../flags";
import chalk from "chalk";
import { withTelemetry } from "../../telemetry";
import { input } from "@inquirer/prompts";

export default class BillingRedeemCoupon extends Command {
  static description = "Redeem a coupon code for credits";

  static examples = [
    "<%= config.bin %> billing redeem-coupon",
    "<%= config.bin %> billing redeem-coupon --code ABC123",
  ];

  static flags = {
    ...commonFlags,
    code: Flags.string({
      required: false,
      description: "Coupon code to redeem",
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(BillingRedeemCoupon);
      const billing = await createBillingClient(flags);

      const code =
        flags.code ??
        (await input({
          message: "Enter your coupon code:",
          validate: (val) => (val.trim().length > 0 ? true : "Coupon code is required"),
        }));

      const result = await billing.redeemCoupon(code.trim());
      const dollars = (result.amountCents / 100).toFixed(2);

      this.log(`\n  ${chalk.green("✓")} Coupon redeemed! ${chalk.cyan(`$${dollars}`)} in credits added to your account.`);
      this.log(`\n  Run ${chalk.cyan("ecloud billing status")} to see your updated balance.\n`);
    });
  }
}
