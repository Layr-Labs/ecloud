import { Command, Flags } from "@oclif/core";
import { createAdminClient } from "../../../client";
import { commonFlags } from "../../../flags";
import chalk from "chalk";
import { withTelemetry } from "../../../telemetry";

export default class AdminCouponsList extends Command {
  static description = "List coupons";

  static examples = [
    "<%= config.bin %> admin coupons list",
    "<%= config.bin %> admin coupons list --active",
    "<%= config.bin %> admin coupons list --redeemed",
  ];

  static flags = {
    ...commonFlags,
    active: Flags.boolean({
      required: false,
      description: "Filter to active coupons only",
    }),
    redeemed: Flags.boolean({
      required: false,
      description: "Filter to redeemed coupons only",
    }),
    limit: Flags.integer({
      required: false,
      description: "Number of results to return",
      default: 25,
    }),
    offset: Flags.integer({
      required: false,
      description: "Offset for pagination",
      default: 0,
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(AdminCouponsList);
      const admin = await createAdminClient(flags);

      const opts: { offset?: number; limit?: number; active?: boolean; redeemed?: boolean } = {
        offset: flags.offset,
        limit: flags.limit,
      };
      if (flags.active) opts.active = true;
      if (flags.redeemed) opts.redeemed = true;

      const { coupons, total } = await admin.listCoupons(opts);

      if (coupons.length === 0) {
        this.log("\n  No coupons found.\n");
        return;
      }

      this.log(`\n${chalk.bold("Coupons")} (${coupons.length} of ${total}):\n`);

      for (const c of coupons) {
        const value = `$${(c.amountCents / 100).toFixed(2)}`;
        const status = c.redeemedBy
          ? chalk.gray(`redeemed by ${c.redeemedBy}`)
          : c.active
            ? chalk.green("active")
            : chalk.red("inactive");
        this.log(`  ${chalk.cyan(c.id)}  ${value}  ${status}`);
      }
      this.log();
    });
  }
}
