import { Command } from "@oclif/core";
import { createBillingClient } from "../../client";
import { commonFlags } from "../../flags";
import chalk from "chalk";
import { withTelemetry } from "../../telemetry";

export default class BillingListCards extends Command {
  static description = "List credit cards on file";

  static flags = {
    ...commonFlags,
  };

  async run() {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(BillingListCards);
      const billing = await createBillingClient(flags);

      const { paymentMethods } = await billing.getPaymentMethods();

      if (paymentMethods.length === 0) {
        this.log(`\n  ${chalk.gray("No cards on file.")}`);
        this.log(`  Run ${chalk.cyan("ecloud billing top-up --method card")} to add one.\n`);
        return;
      }

      this.log(`\n${chalk.bold("Cards on file:")}`);
      for (const card of paymentMethods) {
        const brand = card.brand.charAt(0).toUpperCase() + card.brand.slice(1);
        const added = new Date(card.createdAt).toLocaleDateString();
        this.log(`  • ${brand} ending in ${chalk.bold(card.last4)}  ${chalk.gray(`added ${added}`)}`);
      }
      this.log();
    });
  }
}
