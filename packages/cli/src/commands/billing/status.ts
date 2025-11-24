import { Command, Flags } from "@oclif/core";
import { createBillingClient } from "../../client";
import { commonFlags } from "../../flags";
import chalk from "chalk";

export default class BillingStatus extends Command {
  static description = "Show subscription status";

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
    this.log(`  Status: ${formatStatus(result.subscriptionStatus)}`);
    this.log(`  Product: ${result.productId}`);

    // Display billing period
    if (result.currentPeriodStart && result.currentPeriodEnd) {
      const startDate = new Date(result.currentPeriodStart).toLocaleDateString();
      const endDate = new Date(result.currentPeriodEnd).toLocaleDateString();
      this.log(`  Current Period: ${startDate} - ${endDate}`);
    }

    // Display pricing information
    if (result.upcomingInvoiceTotal !== undefined) {
      const currency = result.lineItems?.[0]?.currency?.toUpperCase() || "USD";
      this.log(
        `  Upcoming Invoice: ${currency} $${result.upcomingInvoiceTotal.toFixed(2)}`
      );
    }

    // Display line items if available
    if (result.lineItems && result.lineItems.length > 0) {
      this.log(`\n${chalk.bold("  Line Items:")}`);
      for (const item of result.lineItems) {
        const product = `${flags.product.charAt(0).toUpperCase()}${flags.product.slice(1)}`;
        const chain = item.description.toLowerCase().includes("sepolia") ? "Sepolia" : "Mainnet";
        this.log(
          `    • ${product} (${chain}): $${item.subtotal.toFixed(2)} (${item.quantity} × $${item.price.toFixed(3)}/vCPU hour)`
        );
      }
    }

    // Display cancellation information
    if (result.cancelAtPeriodEnd) {
      this.log(
        `\n  ${chalk.yellow("⚠ Subscription will cancel at period end")}`
      );
    }

    if (result.canceledAt) {
      const cancelDate = new Date(result.canceledAt).toLocaleDateString();
      this.log(`  Canceled On: ${cancelDate}`);
    }

    // Display portal URL for management
    if (result.portalUrl) {
      this.log(
        `\n  ${chalk.dim("Manage subscription:")} ${chalk.cyan(result.portalUrl)}`
      );
    }

    this.log();
  }
}
