import { Command, Flags } from "@oclif/core";
import { isSubscriptionActive } from "@layr-labs/ecloud-sdk";
import { createBillingClient } from "../../client";
import { commonFlags } from "../../flags";
import chalk from "chalk";
import open from "open";
import { select } from "@inquirer/prompts";
import { withTelemetry } from "../../telemetry";

const PAYMENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL_MS = 3_000; // 3 seconds

export default class BillingSubscribe extends Command {
  static description = "Create subscription to start deploying apps";

  static flags = {
    ...commonFlags,
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

      // Payment method selection: credit card or USDC
      const paymentMethod = await select({
        message: "How would you like to pay for EigenCompute?",
        choices: [
          {
            value: "card",
            name: "Credit card",
            description: "Pay via Stripe checkout (opens browser)",
          },
          {
            value: "usdc",
            name: "Purchase credits with USDC",
            description: "Pay on-chain — no credit card needed",
          },
        ],
      });

      // USDC path: delegate to `ecloud billing top-up`
      if (paymentMethod === "usdc") {
        await this.config.runCommand("billing:top-up", [
          ...(flags["private-key"] ? ["--private-key", flags["private-key"]] : []),
          ...(flags.verbose ? ["--verbose"] : []),
          ...(flags.environment ? ["--environment", flags.environment] : []),
          ...(flags["rpc-url"] ? ["--rpc-url", flags["rpc-url"]] : []),
          "--product", flags.product,
        ]);
        return;
      }

      // Credit card path (existing flow, unchanged)
      this.log(`\nOpening checkout for wallet ${chalk.bold(billing.address)}...`);
      this.log(chalk.gray(`\nURL: ${result.checkoutUrl}`));
      this.log(chalk.gray(`\nPrefer to pay with USDC? Run: ecloud billing top-up`));
      await open(result.checkoutUrl);

      this.log(`\n${chalk.gray("Waiting for payment confirmation...")}`);

      const startTime = Date.now();

      while (Date.now() - startTime < PAYMENT_TIMEOUT_MS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

        try {
          const status = await billing.getStatus({
            productId: flags.product as "compute",
          });

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

      this.log(`\n${chalk.yellow("⚠")} Payment confirmation timed out after 5 minutes.`);
      this.log(
        chalk.gray(`If you completed payment, run 'ecloud billing status' to check status.`),
      );
    });
  }
}
