import { Command, Flags } from "@oclif/core";
import { createAdminClient } from "../../../client";
import { commonFlags } from "../../../flags";
import chalk from "chalk";
import { withTelemetry } from "../../../telemetry";
import { input } from "@inquirer/prompts";

export default class AdminCouponsCreate extends Command {
  static description = "Create a new coupon";

  static examples = [
    "<%= config.bin %> admin coupons create --amount 50",
  ];

  static flags = {
    ...commonFlags,
    amount: Flags.string({
      required: false,
      description: "Coupon value in whole dollars",
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(AdminCouponsCreate);
      const admin = await createAdminClient(flags);

      const amountStr =
        flags.amount ??
        (await input({
          message: "Coupon value in dollars:",
          validate: (val) => {
            const n = parseFloat(val);
            if (isNaN(n) || n <= 0) return "Enter a positive number";
            return true;
          },
        }));

      const dollars = parseFloat(amountStr);
      const amountCents = Math.round(dollars * 100);

      const { coupon } = await admin.createCoupon(amountCents);

      this.log(`\n${chalk.green("✓")} Coupon created`);
      this.log(`  ID:     ${chalk.cyan(coupon.id)}`);
      this.log(`  Value:  ${chalk.cyan(`$${(coupon.amountCents / 100).toFixed(2)}`)}`);
      this.log(`  Active: ${coupon.active ? chalk.green("yes") : chalk.red("no")}\n`);
    });
  }
}
