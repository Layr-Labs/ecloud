import { Command, Flags } from "@oclif/core";
import { createBillingClient } from "../../client";
import { commonFlags } from "../../flags";
import { getEnvironmentConfig, type AccountCreditsResponse } from "@layr-labs/ecloud-sdk";
import { createViemClients } from "../../utils/viemClients";
import { errorMessage } from "../../utils/exitCodes";
import { formatEther, formatUnits } from "viem";
import chalk from "chalk";
import { withTelemetry } from "../../telemetry";
import { formatFundsBlock } from "../../utils/billingFormat";

export default class BillingStatus extends Command {
  static description = "Show subscription status";

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
      const { flags } = await this.parse(BillingStatus);
      const billing = await createBillingClient(flags);

      const result = await billing.getStatus({
        productId: flags.product as "compute",
      });

      // Format status with appropriate color and symbol
      const formatStatus = (status: string) => {
        switch (status) {
          case "active":
            return `${chalk.green("✓ Active")}`;
          case "trialing":
            return `${chalk.green("✓ Trial")}`;
          case "past_due":
            return `${chalk.yellow("⚠ Past Due")}`;
          case "canceled":
            return `${chalk.red("✗ Canceled")}`;
          case "inactive":
            return `${chalk.gray("✗ Inactive")}`;
          case "incomplete":
            return `${chalk.yellow("⚠ Incomplete")}`;
          case "incomplete_expired":
            return `${chalk.red("✗ Expired")}`;
          case "unpaid":
            return `${chalk.yellow("⚠ Unpaid")}`;
          case "paused":
            return `${chalk.yellow("⚠ Paused")}`;
          default:
            return status;
        }
      };

      this.log(`\n${chalk.bold("Subscription Status:")}`);
      this.log(`  Wallet: ${billing.address}`);

      this.log(`  Status: ${formatStatus(result.subscriptionStatus)}`);
      this.log(`  Product: ${result.productId}`);

      // Display billing period
      if (result.currentPeriodStart && result.currentPeriodEnd) {
        const startDate = new Date(result.currentPeriodStart).toLocaleDateString();
        const endDate = new Date(result.currentPeriodEnd).toLocaleDateString();
        this.log(`  Current Period: ${startDate} - ${endDate}`);
      }

      // Display line items if available
      if (result.lineItems && result.lineItems.length > 0) {
        this.log(`\n${chalk.bold("  Line Items:")}`);
        for (const item of result.lineItems) {
          const product = `${flags.product.charAt(0).toUpperCase()}${flags.product.slice(1)}`;
          const isChainSpecific = item.description.match(/\b(sepolia|mainnet)\b/i);
          if (isChainSpecific) {
            const chain = item.description.toLowerCase().includes("sepolia")
              ? "Sepolia"
              : "Mainnet";
            this.log(
              `    • ${product} (${chain}): $${item.subtotal.toFixed(2)} (${item.quantity} vCPU hours × $${item.price.toFixed(3)}/vCPU hour)`,
            );
          } else {
            const sku = item.description.split(" ").slice(-2).join(" ") || "Unknown";
            this.log(
              `    • ${product} (${sku}): $${item.subtotal.toFixed(2)} (${item.quantity} hours × $${item.price.toFixed(3)}/hour)`,
            );
          }
        }
      }

      // --- Funds: Stripe credit split + on-chain wallet (each best-effort) ---
      let credits: AccountCreditsResponse | undefined;
      try {
        credits = await billing.getAccountCredits();
      } catch (err) {
        this.warn(`Could not read credit split: ${errorMessage(err)}`);
      }

      let walletEthFormatted: string | undefined;
      let walletUsdcFormatted: string | undefined;
      const privateKey = flags["private-key"];
      if (privateKey) {
        const environment = flags.environment;
        const environmentConfig = getEnvironmentConfig(environment);
        const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;
        try {
          const { publicClient, address } = createViemClients({ privateKey, rpcUrl, environment });
          const balanceWei = await publicClient.getBalance({ address });
          walletEthFormatted = formatEther(balanceWei);
        } catch (err) {
          this.warn(`Could not read wallet ETH balance: ${errorMessage(err)}`);
        }
        try {
          const { usdcBalance } = await billing.getTopUpInfo();
          walletUsdcFormatted = formatUnits(usdcBalance, 6);
        } catch (err) {
          this.warn(`Could not read wallet USDC balance: ${errorMessage(err)}`);
        }
      }

      for (const line of formatFundsBlock({
        env: flags.environment,
        credits,
        remainingCreditsFallback: result.remainingCredits,
        nextCreditExpiryFallback: result.nextCreditExpiry,
        walletEthFormatted,
        walletUsdcFormatted,
      })) {
        this.log(line);
      }

      // Display cancellation information
      if (result.cancelAtPeriodEnd) {
        this.log(`\n  ${chalk.yellow("⚠ Subscription will cancel at period end")}`);
      }

      if (result.canceledAt) {
        const cancelDate = new Date(result.canceledAt).toLocaleDateString();
        this.log(`  Canceled On: ${cancelDate}`);
      }

      // Display portal URL for management
      if (result.portalUrl) {
        this.log(`\n${chalk.bold("Payment & Invoices:")}`);
        this.log(`  ${chalk.cyan(result.portalUrl)}`);
      }

      // Surface top-up option when credits are low or subscription is inactive
      if (
        result.subscriptionStatus === "inactive" ||
        (result.remainingCredits !== undefined && result.remainingCredits < 10)
      ) {
        this.log(`\n${chalk.bold("Need more credits?")}`);
        this.log(`  Run ${chalk.cyan("ecloud billing top-up")} to purchase credits.`);
      }

      this.log();
    });
  }
}
