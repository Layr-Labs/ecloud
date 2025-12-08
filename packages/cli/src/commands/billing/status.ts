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

    const formatExpiry = (timestamp?: number) =>
      timestamp ? ` (expires ${new Date(timestamp * 1000).toLocaleDateString()})` : "";

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

    // Display line items if available
    if (result.lineItems && result.lineItems.length > 0) {
      this.log(`\n${chalk.bold("  Line Items:")}`);
      for (const item of result.lineItems) {
        const product = `${flags.product.charAt(0).toUpperCase()}${flags.product.slice(1)}`;
        const chain = item.description.toLowerCase().includes("sepolia") ? "Sepolia" : "Mainnet";
        this.log(
          `    • ${product} (${chain}): $${item.subtotal.toFixed(2)} (${item.quantity} vCPU hours × $${item.price.toFixed(3)}/vCPU hour)`,
        );
      }
    }

    // Display invoice summary with credits
    if (result.creditsApplied !== undefined && result.creditsApplied > 0) {
      this.log(`\n${chalk.bold("  Invoice Summary:")}`);
      const subtotal = result.upcomingInvoiceSubtotal ?? result.upcomingInvoiceTotal ?? 0;
      this.log(`    Subtotal:         $${subtotal.toFixed(2)}`);
      this.log(`    Credits Applied: ${chalk.green(`-$${result.creditsApplied.toFixed(2)}`)}`);
      this.log(`    ${"─".repeat(21)}`);
      this.log(`    Total Due:        $${(result.upcomingInvoiceTotal ?? 0).toFixed(2)}`);

      if (result.remainingCredits !== undefined) {
        this.log(
          `\n  ${chalk.bold("Remaining Credits:")} ${chalk.cyan(`$${result.remainingCredits.toFixed(2)}`)}${formatExpiry(result.nextCreditExpiry)}`,
        );
      }
    } else if (result.upcomingInvoiceTotal !== undefined) {
      this.log(`\n  Upcoming Invoice: $${result.upcomingInvoiceTotal.toFixed(2)}`);
      if (result.remainingCredits !== undefined && result.remainingCredits > 0) {
        this.log(
          `  ${chalk.bold("Available Credits:")} ${chalk.cyan(`$${result.remainingCredits.toFixed(2)}`)}${formatExpiry(result.nextCreditExpiry)}`,
        );
      }
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
      this.log(`\n  ${chalk.dim("Manage subscription:")} ${chalk.cyan(result.portalUrl)}`);
    }

    this.log();
  }
}
