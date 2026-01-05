import { Command, Flags } from "@oclif/core";
import { isSubscriptionActive } from "@layr-labs/ecloud-sdk";
import { createBillingClient } from "../../client";
import { commonFlags } from "../../flags";
import chalk from "chalk";
import open from "open";
import { withTelemetry } from "../../telemetry";

const PAYMENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL_MS = 3_000; // 3 seconds

export default class BillingSubscribe extends Command {
  static description = "Create subscription to start deploying apps";

  static flags = {
    "private-key": commonFlags["private-key"],
    verbose: commonFlags.verbose,
    product: Flags.string({
      required: false,
      description: "Product ID",
      default: "compute",
      options: ["compute"],
      env: "ECLOUD_PRODUCT_ID",
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(BillingSubscribe);
      const billing = await createBillingClient(flags);

      this.debug(`\nChecking subscription status for ${flags.product}...`);

      const result = await billing.subscribe({
        productId: flags.product as "compute",
      });

      // Handle already active subscription
      if (result.type === "already_active") {
        this.log(
          `\n${chalk.green("✓")} Wallet ${chalk.bold(billing.address)} is already subscribed to ${flags.product}.`,
        );
        this.log(chalk.gray("Run 'ecloud billing status' for details."));
        return;
      }

      // Handle payment issue
      if (result.type === "payment_issue") {
        this.log(
          `\n${chalk.yellow("⚠")} You already have a subscription on ${flags.product}, but it has a payment issue.`,
        );
        this.log("Please update your payment method to restore access.");

        if (result.portalUrl) {
          this.log(`\n${chalk.bold("Update payment method:")}`);
          this.log(`  ${result.portalUrl}`);
        }
        return;
      }

      // Open checkout URL in browser
      this.log(`\nOpening checkout for wallet ${chalk.bold(billing.address)}...`);
      this.log(chalk.gray(`\nURL: ${result.checkoutUrl}`));
      await open(result.checkoutUrl);

      // Poll for subscription status
      this.log(`\n${chalk.gray("Waiting for payment confirmation...")}`);

      const startTime = Date.now();

      while (Date.now() - startTime < PAYMENT_TIMEOUT_MS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

        try {
          const status = await billing.getStatus({
            productId: flags.product as "compute",
          });

          // Check if subscription is now active or trialing
          if (isSubscriptionActive(status.subscriptionStatus)) {
            this.log(
              `\n${chalk.green("✓")} Subscription activated successfully for ${flags.product}!`,
            );
            this.log(`\n${chalk.gray("Start deploying with:")} ecloud compute app deploy`);
            return;
          }
        } catch (error) {
          this.debug(`Error polling for subscription status: ${error}`);
        }
      }

      // Timeout reached
      this.log(`\n${chalk.yellow("⚠")} Payment confirmation timed out after 5 minutes.`);
      this.log(
        chalk.gray(`If you completed payment, run 'ecloud billing status' to check status.`),
      );
    });
  }
}
