/**
 * ecloud billing top-up — Purchase EigenCompute credits
 *
 * Designed to eventually execute the USDC transaction directly from the CLI,
 * since the user already has a private key loaded. For this PoC, it checks
 * the wallet's USDC balance and either:
 *   a) Prompts for an amount and shows a TODO for tx submission
 *   b) Shows the wallet address to fund if USDC balance is insufficient
 *
 * Future: add credit card top-up as a second payment method within this
 * same command (per Cavan's design — "initially USDC, then eventually CC").
 */

import { Command, Flags } from "@oclif/core";
import { createBillingClient } from "../../client";
import { commonFlags } from "../../flags";
import chalk from "chalk";
import { withTelemetry } from "../../telemetry";

// TODO: Fetch from billing API (e.g., GET /products/:product_id/credit-purchase-info)
// These must match the billing API's USDC_DEPOSIT_CONTRACT_ADDRESS config (PR #22).
const CREDIT_PURCHASE_CONTRACT = "0x..." // TODO: Replace with deployed contract address
const CREDIT_PURCHASE_CHAIN = "Base";
const CREDIT_PURCHASE_CHAIN_ID = 8453;

export default class BillingTopUp extends Command {
  static description = "Purchase EigenCompute credits";

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
      const { flags } = await this.parse(BillingTopUp);
      const billing = await createBillingClient(flags);

      this.log(`\n${chalk.bold("Purchase EigenCompute credits")}`);
      this.log(`${chalk.gray("─".repeat(45))}`);

      this.log(`\n  ${chalk.bold("Your wallet:")}  ${billing.address}`);

      // ── Step 1: Check current credit balance ──
      // The getStatus endpoint already returns remainingCredits,
      // which includes both Stripe and USDC-purchased credits.
      let currentCredits: number | undefined;
      try {
        const status = await billing.getStatus({
          productId: flags.product as "compute",
        });
        currentCredits = status.remainingCredits;
        if (currentCredits !== undefined) {
          this.log(`  ${chalk.bold("Credits:")}      ${chalk.cyan(`$${currentCredits.toFixed(2)}`)}`);
        }
      } catch {
        this.debug("Could not fetch current credit balance");
      }

      // ── Step 2: Check wallet USDC balance ──
      // TODO: Use viem to read USDC balance on Base for billing.address
      // const usdcBalance = await publicClient.readContract({
      //   address: USDC_TOKEN_ADDRESS,
      //   abi: erc20Abi,
      //   functionName: 'balanceOf',
      //   args: [billing.address],
      // });

      // ── Step 3: If wallet has USDC, prompt for amount and submit tx ──
      // TODO: When USDC balance > 0:
      //   1. Prompt user for amount (or accept --amount flag)
      //   2. Build approve + purchaseCredits transaction
      //   3. Sign with the user's wallet (private key already available)
      //   4. Submit transaction
      //   5. Poll billing API for credit confirmation
      //
      // const amount = await input({ message: "How much USDC to spend on credits?" });
      // const tx = await walletClient.writeContract({
      //   address: CREDIT_PURCHASE_CONTRACT,
      //   abi: creditPurchaseAbi,
      //   functionName: 'purchaseCredits',
      //   args: [billing.address, parseUnits(amount, 6)],
      // });
      // this.log(`Transaction submitted: ${tx}`);
      // this.log("Waiting for credits to appear...");

      // ── Step 3 (stub): Show purchase instructions ──
      // Until the tx submission is wired up, show the manual path.

      this.log(`\n${chalk.bold("  Purchase with USDC")}`);
      this.log(`  ${chalk.bold("Contract:")}     ${chalk.cyan(CREDIT_PURCHASE_CONTRACT)}`);
      this.log(`  ${chalk.bold("Chain:")}        ${CREDIT_PURCHASE_CHAIN} (Chain ID: ${CREDIT_PURCHASE_CHAIN_ID})`);
      this.log(`  ${chalk.bold("Token:")}        USDC`);

      this.log(`\n${chalk.bold("  How it works:")}`);
      this.log(`  1. Send USDC to the contract on ${CREDIT_PURCHASE_CHAIN}`);
      this.log(`  2. Credits appear after on-chain confirmation`);
      this.log(`  3. First purchase gets up to $25 matched`);

      this.log(`\n${chalk.yellow("  Note:")} Credits are non-refundable.`);
      this.log(`  Send only USDC on ${CREDIT_PURCHASE_CHAIN} — other tokens will not be credited.`);

      this.log(`\n  ${chalk.gray("Check your balance:")} ecloud billing status`);
      this.log();
    });
  }
}
