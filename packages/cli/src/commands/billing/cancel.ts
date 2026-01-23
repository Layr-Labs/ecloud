import { Command, Flags } from "@oclif/core";
import { isSubscriptionActive } from "@layr-labs/ecloud-sdk";
import { createBillingClient } from "../../client";
import { commonFlags } from "../../flags";
import chalk from "chalk";
import { confirm } from "@inquirer/prompts";
import { withTelemetry } from "../../telemetry";

export default class BillingCancel extends Command {
  static description = "Cancel subscription";

  static flags = {
    "private-key": commonFlags["private-key"],
    verbose: commonFlags.verbose,
    product: Flags.string({
      required: false,
      description: "Product ID",
      default: "compute",
      options: ["compute", "eigenai"],
      env: "ECLOUD_PRODUCT_ID",
    }),
    force: Flags.boolean({
      char: "f",
      description: "Skip confirmation prompt",
      default: false,
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(BillingCancel);
      const billing = await createBillingClient(flags);

      // Check subscription status first
      this.debug(`\nChecking subscription status for ${flags.product}...`);
      const status = await billing.getStatus({
        productId: flags.product as "compute" | "eigenai",
      });

      // Check if there's an active subscription to cancel
      if (!isSubscriptionActive(status.subscriptionStatus)) {
        this.log(`\n${chalk.gray("You don't have an active subscription to cancel.")}`);
        this.log(chalk.gray(`Current status: ${status.subscriptionStatus}`));
        return;
      }

      // Confirm cancellation unless --force flag is used
      if (!flags.force) {
        const confirmed = await confirm({
          message: `${chalk.yellow("Warning:")} This will cancel the ${flags.product} subscription for wallet ${chalk.bold(billing.address)}. Continue?`,
        });
        if (!confirmed) {
          this.log(chalk.gray("\nCancellation aborted."));
          return;
        }
      }

      this.log(`\nCanceling subscription for ${flags.product}...`);

      const result = await billing.cancel({
        productId: flags.product as "compute" | "eigenai",
      });

      // Handle response (defensive - should always be canceled at this point)
      if (result.type === "canceled") {
        this.log(`\n${chalk.green("✓")} Subscription canceled successfully.`);
      } else {
        this.log(
          `\n${chalk.gray("Subscription status changed. Current status:")} ${result.status}`,
        );
      }
    });
  }
}
