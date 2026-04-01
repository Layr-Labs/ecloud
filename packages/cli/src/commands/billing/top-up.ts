/**
 * ecloud billing top-up — Purchase EigenCompute credits with USDC
 *
 * Executes USDCCredits.purchaseCreditsFor(amount, account) on-chain via the SDK
 * billing module's topUp() method (EIP-7702 batched transaction).
 *
 * Flow:
 *   1. Check current credit balance
 *   2. Read wallet's USDC balance via SDK
 *   3. If USDC available → prompt for amount → SDK topUp() → poll for confirmation
 *   4. If no USDC → show wallet address, tell user to fund it
 */

import { Command, Flags } from "@oclif/core";
import { createBillingClient } from "../../client";
import { commonFlags } from "../../flags";
import { type Address, formatUnits } from "viem";
import chalk from "chalk";
import { input } from "@inquirer/prompts";
import { withTelemetry } from "../../telemetry";

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

export default class BillingTopUp extends Command {
  static description = "Purchase EigenCompute credits with USDC";

  static flags = {
    ...commonFlags,
    amount: Flags.string({
      required: false,
      description: "Amount of USDC to spend (e.g., '50')",
    }),
    account: Flags.string({
      required: false,
      description: "Target account address for purchaseCreditsFor (defaults to your wallet)",
    }),
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

      // Create billing client
      const billing = await createBillingClient(flags);

      const walletAddress = billing.address;
      const targetAccount = (flags.account as Address) ?? walletAddress;

      this.log(`\n${chalk.bold("Purchase EigenCompute credits")}`);
      this.log(`${chalk.gray("─".repeat(45))}`);
      this.log(`\n  ${chalk.bold("Wallet:")}  ${walletAddress}`);
      if (targetAccount !== walletAddress) {
        this.log(`  ${chalk.bold("Target:")}  ${targetAccount}`);
      }

      // ── Step 1: Show current credit balance ──
      // Track total credits (remaining + applied) so we detect top-ups even
      // when new credits are immediately consumed by an outstanding bill.
      let baselineTotal: number | undefined;
      try {
        const status = await billing.getStatus({
          productId: flags.product as "compute",
        });
        const remaining = status.remainingCredits ?? 0;
        const applied = status.creditsApplied ?? 0;
        baselineTotal = remaining + applied;
        if (status.remainingCredits !== undefined) {
          this.log(`  ${chalk.bold("Credits:")} ${chalk.cyan(`$${status.remainingCredits.toFixed(2)}`)}`);
        }
      } catch {
        this.debug("Could not fetch current credit balance");
      }

      // ── Step 2: Read on-chain state via SDK ──
      const onChainState = await billing.getTopUpInfo();
      const { usdcBalance, minimumPurchase } = onChainState;

      const balanceFormatted = formatUnits(usdcBalance, 6);
      this.log(`  ${chalk.bold("USDC:")}    ${balanceFormatted} USDC`);

      if (usdcBalance === BigInt(0)) {
        this.log(`\n${chalk.yellow("  No USDC in wallet.")}`);
        this.log(`  Send USDC on Sepolia to: ${chalk.cyan(walletAddress)}`);
        this.log(`  Then re-run: ${chalk.cyan("ecloud billing top-up")}\n`);
        return;
      }

      // ── Step 3: Prompt for amount ──
      const minimumFormatted = formatUnits(minimumPurchase, 6);
      const amountStr =
        flags.amount ??
        (await input({
          message: `How much USDC to spend on credits? (minimum: ${minimumFormatted})`,
          validate: (val) => {
            const n = parseFloat(val);
            if (isNaN(n) || n <= 0) return "Enter a positive number";
            const raw = BigInt(Math.round(n * 1e6));
            if (raw < minimumPurchase)
              return `Minimum purchase is ${minimumFormatted} USDC`;
            if (raw > usdcBalance)
              return `Insufficient balance. You have ${balanceFormatted} USDC`;
            return true;
          },
        }));

      const amountFloat = parseFloat(amountStr);
      const amountRaw = BigInt(Math.round(amountFloat * 1e6));

      if (amountRaw < minimumPurchase) {
        this.error(`Minimum purchase is ${minimumFormatted} USDC`);
      }
      if (amountRaw > usdcBalance) {
        this.error(
          `Insufficient USDC balance. You have ${balanceFormatted} USDC but requested ${amountFloat.toFixed(2)}`,
        );
      }

      this.log(`\n  Purchasing ${chalk.bold(`$${amountFloat.toFixed(2)}`)} in credits...`);

      // ── Step 4: Execute on-chain purchase via SDK ──
      const { txHash } = await billing.topUp({
        amount: amountRaw,
        account: targetAccount,
      });
      this.log(`  ${chalk.green("✓")} Transaction confirmed: ${txHash}`);

      // ── Step 5: Poll billing API for credit confirmation ──
      this.log(chalk.gray("\n  Waiting for credits to appear..."));
      const startTime = Date.now();
      while (Date.now() - startTime < POLL_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        try {
          const status = await billing.getStatus({
            productId: flags.product as "compute",
          });
          const remaining = status.remainingCredits ?? 0;
          const applied = status.creditsApplied ?? 0;
          const currentTotal = remaining + applied;
          this.debug(`Poll: remaining=${remaining}, applied=${applied}, total=${currentTotal}, baseline=${baselineTotal}`);
          if (
            baselineTotal === undefined || currentTotal > baselineTotal
          ) {
            const creditsAdded = baselineTotal !== undefined ? currentTotal - baselineTotal : undefined;
            const isMatched = creditsAdded !== undefined && Math.abs(creditsAdded - amountFloat * 2) < 0.01;
            const appliedFromTopUp = creditsAdded !== undefined ? creditsAdded - remaining : 0;

            this.log(`\n  ${chalk.green("✓")} Credits received: ${chalk.cyan(`$${(creditsAdded ?? amountFloat).toFixed(2)}`)}`);
            if (isMatched) {
              this.log(`  ${chalk.green("✓")} Includes $${amountFloat.toFixed(2)} match bonus!`);
            }
            if (remaining > 0) {
              this.log(`  Remaining balance: ${chalk.cyan(`$${remaining.toFixed(2)}`)}`);
            }
            if (appliedFromTopUp > 0) {
              this.log(`  ${chalk.gray(`$${appliedFromTopUp.toFixed(2)} applied to current bill`)}`);
            }
            this.log();
            return;
          }
        } catch {
          this.debug("Error polling for credit balance");
        }
      }

      this.log(
        `\n  ${chalk.yellow("⚠")} Credits haven't appeared yet. This can take a few minutes.`,
      );
      this.log(`  ${chalk.gray("Check your balance:")} ecloud billing status\n`);
    });
  }
}
