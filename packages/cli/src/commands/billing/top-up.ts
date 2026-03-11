/**
 * ecloud billing top-up — Purchase EigenCompute credits with USDC
 *
 * Executes USDCCredits.purchaseCreditsFor(amount, account) on-chain via Sepolia.
 * The user's wallet is already loaded (private key is a prerequisite
 * for all billing commands), so we can form and submit the tx directly.
 *
 * Flow:
 *   1. Check current credit balance
 *   2. Read wallet's USDC balance on Sepolia
 *   3. If USDC available → prompt for amount → approve + purchaseCreditsFor → poll for confirmation
 *   4. If no USDC → show wallet address, tell user to fund it
 */

import { Command, Flags } from "@oclif/core";
import { createBillingClient } from "../../client";
import { commonFlags } from "../../flags";
import { createViemClients } from "../../utils/viemClients";
import {
  getEnvironmentConfig,
  USDCCreditsABI,
  ERC20ABI,
} from "@layr-labs/ecloud-sdk";
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

      // Create billing client for API calls (getStatus)
      const billing = await createBillingClient(flags);

      // Create viem clients for on-chain interactions
      const privateKey = flags["private-key"];
      if (!privateKey) {
        this.error("Private key is required for on-chain transactions");
      }
      const { publicClient, walletClient, address: walletAddress } = createViemClients({
        privateKey,
        rpcUrl: flags["rpc-url"],
        environment: flags.environment,
      });

      // Resolve USDCCredits contract address from environment config
      const environmentConfig = getEnvironmentConfig(flags.environment);
      const usdcCreditsAddress = environmentConfig.usdcCreditsAddress;
      if (!usdcCreditsAddress) {
        this.error(
          `USDCCredits contract is not configured for environment "${flags.environment}". ` +
          `USDC credit purchasing is only available on environments with a deployed USDCCredits contract.`,
        );
      }

      const targetAccount = (flags.account as Address) ?? walletAddress;

      this.log(`\n${chalk.bold("Purchase EigenCompute credits")}`);
      this.log(`${chalk.gray("─".repeat(45))}`);
      this.log(`\n  ${chalk.bold("Wallet:")}  ${walletAddress}`);
      if (targetAccount !== walletAddress) {
        this.log(`  ${chalk.bold("Target:")}  ${targetAccount}`);
      }

      // ── Step 1: Show current credit balance ──
      let currentCredits: number | undefined;
      try {
        const status = await billing.getStatus({
          productId: flags.product as "compute",
        });
        currentCredits = status.remainingCredits;
        if (currentCredits !== undefined) {
          this.log(`  ${chalk.bold("Credits:")} ${chalk.cyan(`$${currentCredits.toFixed(2)}`)}`);
        }
      } catch {
        this.debug("Could not fetch current credit balance");
      }

      // ── Step 2: Read on-chain state ──
      const usdcAddress = await publicClient.readContract({
        address: usdcCreditsAddress,
        abi: USDCCreditsABI,
        functionName: "usdc",
      }) as Address;

      const minimumPurchase = await publicClient.readContract({
        address: usdcCreditsAddress,
        abi: USDCCreditsABI,
        functionName: "minimumPurchase",
      }) as bigint;

      const usdcBalance = await publicClient.readContract({
        address: usdcAddress,
        abi: ERC20ABI,
        functionName: "balanceOf",
        args: [walletAddress],
      }) as bigint;

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

      // ── Step 4: Approve USDC spend if needed ──
      const currentAllowance = await publicClient.readContract({
        address: usdcAddress,
        abi: ERC20ABI,
        functionName: "allowance",
        args: [walletAddress, usdcCreditsAddress],
      }) as bigint;

      if (currentAllowance < amountRaw) {
        this.log(chalk.gray("  Approving USDC spend..."));
        const approveTx = await walletClient.writeContract({
          address: usdcAddress,
          abi: ERC20ABI,
          functionName: "approve",
          args: [usdcCreditsAddress, amountRaw],
          chain: walletClient.chain,
          account: walletClient.account!,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
        this.log(`  ${chalk.green("✓")} Approved`);
      }

      // ── Step 5: Call purchaseCreditsFor(amount, account) ──
      this.log(chalk.gray("  Submitting credit purchase..."));
      const purchaseTx = await walletClient.writeContract({
        address: usdcCreditsAddress,
        abi: USDCCreditsABI,
        functionName: "purchaseCreditsFor",
        args: [amountRaw, targetAccount],
        chain: walletClient.chain,
        account: walletClient.account!,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: purchaseTx });
      this.log(`  ${chalk.green("✓")} Transaction confirmed: ${receipt.transactionHash}`);

      // ── Step 6: Poll billing API for credit confirmation ──
      this.log(chalk.gray("\n  Waiting for credits to appear..."));
      const startTime = Date.now();
      while (Date.now() - startTime < POLL_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        try {
          const status = await billing.getStatus({
            productId: flags.product as "compute",
          });
          if (
            status.remainingCredits !== undefined &&
            (currentCredits === undefined || status.remainingCredits > currentCredits)
          ) {
            this.log(
              `\n  ${chalk.green("✓")} Credits received! Balance: ${chalk.cyan(`$${status.remainingCredits.toFixed(2)}`)}`,
            );
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
