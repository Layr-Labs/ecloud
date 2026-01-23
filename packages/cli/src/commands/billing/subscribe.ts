import { Command, Flags } from "@oclif/core";
import { isSubscriptionActive } from "@layr-labs/ecloud-sdk";
import type { ProductID, ChainID } from "@layr-labs/ecloud-sdk";
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
      options: ["compute", "eigenai"],
      env: "ECLOUD_PRODUCT_ID",
    }),
    "chain-id": Flags.string({
      required: false,
      description: "Chain ID for EigenAI subscription (required when product is eigenai)",
      options: ["ethereum-mainnet", "ethereum-sepolia"],
      env: "ECLOUD_CHAIN_ID",
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(BillingSubscribe);
      const billing = await createBillingClient(flags);

      this.debug(`\nChecking subscription status for ${flags.product}...`);

      // Handle compute subscription
      if (flags.product === "compute") {
        await this.handleComputeSubscription(billing);
        return;
      }

      // Handle eigenai subscription
      if (flags.product === "eigenai") {
        // Validate chain-id is provided for eigenai product
        if (!flags["chain-id"]) {
          this.error(
            `${chalk.red("Error:")} --chain-id is required when subscribing to eigenai.\n` +
              `  Use: ecloud billing subscribe --product eigenai --chain-id ethereum-mainnet`,
          );
        }
        await this.handleEigenAISubscription(billing, flags["chain-id"] as ChainID);
        return;
      }
    });
  }

  /**
   * Handle subscription for compute product
   */
  private async handleComputeSubscription(
    billing: Awaited<ReturnType<typeof createBillingClient>>,
  ) {
    const result = await billing.subscribe({
      productId: "compute",
    });

    // Handle already active subscription
    if (result.type === "already_active") {
      this.log(
        `\n${chalk.green("✓")} Wallet ${chalk.bold(billing.address)} is already subscribed to compute.`,
      );
      this.log(chalk.gray("Run 'ecloud billing status' for details."));
      return;
    }

    // Handle payment issue
    if (result.type === "payment_issue") {
      this.log(
        `\n${chalk.yellow("⚠")} You already have a subscription on compute, but it has a payment issue.`,
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
    const activated = await this.pollForSubscriptionStatus(billing, "compute");

    if (activated) {
      this.log(`\n${chalk.green("✓")} Subscription activated successfully for compute!`);
      this.log(`\n${chalk.gray("Start deploying with:")} ecloud compute app deploy`);
    } else {
      this.log(`\n${chalk.yellow("⚠")} Payment confirmation timed out after 5 minutes.`);
      this.log(
        chalk.gray(`If you completed payment, run 'ecloud billing status' to check status.`),
      );
    }
  }

  /**
   * Handle subscription for eigenai product
   */
  private async handleEigenAISubscription(
    billing: Awaited<ReturnType<typeof createBillingClient>>,
    chainId: ChainID,
  ) {
    const result = await billing.subscribeEigenAI({
      productId: "eigenai",
      chainId,
    });

    // Handle already active subscription
    if (result.type === "already_active") {
      this.log(
        `\n${chalk.green("✓")} Wallet ${chalk.bold(billing.address)} is already subscribed to eigenai.`,
      );
      this.log(chalk.gray("Run 'ecloud billing status --product eigenai' for details."));
      return;
    }

    // Handle payment issue
    if (result.type === "payment_issue") {
      this.log(
        `\n${chalk.yellow("⚠")} You already have a subscription on eigenai, but it has a payment issue.`,
      );
      this.log("Please update your payment method to restore access.");

      if (result.portalUrl) {
        this.log(`\n${chalk.bold("Update payment method:")}`);
        this.log(`  ${result.portalUrl}`);
      }
      return;
    }

    // Display the API key prominently - this is shown only once!
    this.log(`\n${chalk.bgYellow.black(" IMPORTANT ")} ${chalk.yellow("Save your API key now!")}`);
    this.log(chalk.yellow("This key will only be shown once and cannot be recovered.\n"));
    this.log(`${chalk.bold("Your EigenAI API Key:")}`);
    this.log(`  ${chalk.cyan(result.apiKey)}\n`);
    this.log(chalk.gray("Store this key securely. You will need it to authenticate API requests."));

    // Open checkout URL in browser
    this.log(`\n${chalk.bold("Opening checkout for wallet")} ${chalk.bold(billing.address)}...`);
    this.log(chalk.gray(`\nURL: ${result.checkoutUrl}`));
    await open(result.checkoutUrl);

    // Poll for subscription status
    this.log(`\n${chalk.gray("Waiting for payment confirmation...")}`);
    const activated = await this.pollForSubscriptionStatus(billing, "eigenai");

    if (activated) {
      this.log(`\n${chalk.green("✓")} Subscription activated successfully for eigenai!`);
      this.log(
        `\n${chalk.gray("Your EigenAI subscription is now active. Use your API key to make requests.")}`,
      );
    } else {
      this.log(`\n${chalk.yellow("⚠")} Payment confirmation timed out after 5 minutes.`);
      this.log(
        chalk.gray(
          `If you completed payment, run 'ecloud billing status --product eigenai' to check status.`,
        ),
      );
    }
  }

  /**
   * Poll for subscription activation status
   * @returns true if subscription became active, false if timed out
   */
  private async pollForSubscriptionStatus(
    billing: Awaited<ReturnType<typeof createBillingClient>>,
    productId: ProductID,
  ): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < PAYMENT_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      try {
        const status = await billing.getStatus({ productId });

        // Check if subscription is now active or trialing
        if (isSubscriptionActive(status.subscriptionStatus)) {
          return true;
        }
      } catch (error) {
        this.debug(`Error polling for subscription status: ${error}`);
      }
    }

    return false;
  }
}
