/**
 * ecloud billing top-up — Purchase EigenCompute credits with USDC
 *
 * Executes USDCCredits.purchaseCreditsFor(amount, appID) on-chain.
 * The user's wallet is already loaded (private key is a prerequisite
 * for all billing commands), so we can form and submit the tx directly.
 *
 * Flow:
 *   1. Check current credit balance
 *   2. Read wallet's USDC balance on Base
 *   3. If USDC available → prompt for amount → approve + purchaseCreditsFor → poll for confirmation
 *   4. If no USDC → show wallet address, tell user to fund it
 *
 * Future: add credit card top-up as a second payment method within this
 * same command (per Cavan — "initially USDC, then eventually CC").
 */

import { Command, Flags } from "@oclif/core";
import { createBillingClient } from "../../client";
import { commonFlags } from "../../flags";
import chalk from "chalk";
import { input } from "@inquirer/prompts";
import { withTelemetry } from "../../telemetry";

// TODO: Replace with deployed contract addresses once PR #22 lands.
// These should be fetched from the billing API or config, not hardcoded.
const USDC_CREDITS_CONTRACT = "0x..." as `0x${string}`; // USDCCredits contract on Base
const USDC_TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`; // USDC on Base
const CHAIN_ID = 8453; // Base mainnet

// Minimal ABIs for the two contract calls we need
const USDC_CREDITS_ABI = [
  {
    name: "purchaseCreditsFor",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [],
  },
] as const;

const ERC20_APPROVE_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

export default class BillingTopUp extends Command {
  static description = "Purchase EigenCompute credits with USDC";

  static flags = {
    "private-key": commonFlags["private-key"],
    verbose: commonFlags.verbose,
    amount: Flags.string({
      required: false,
      description: "Amount of USDC to spend (e.g., '50')",
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
      const billing = await createBillingClient(flags);

      this.log(`\n${chalk.bold("Purchase EigenCompute credits")}`);
      this.log(`${chalk.gray("─".repeat(45))}`);
      this.log(`\n  ${chalk.bold("Wallet:")}  ${billing.address}`);

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

      // ── Step 2: Check USDC balance on Base ──
      // TODO: Create a public client for Base to read on-chain state.
      // The billing client only has a signing wallet (no RPC for Base).
      // We need a Base RPC URL — either from config or a public endpoint.
      //
      // const publicClient = createPublicClient({
      //   chain: base,
      //   transport: http("https://mainnet.base.org"),
      // });
      //
      // const usdcBalance = await publicClient.readContract({
      //   address: USDC_TOKEN_ADDRESS,
      //   abi: ERC20_APPROVE_ABI,
      //   functionName: "balanceOf",
      //   args: [billing.address],
      // });
      //
      // const balanceFormatted = formatUnits(usdcBalance, 6);
      // this.log(`  ${chalk.bold("USDC:")}    ${balanceFormatted} USDC (Base)`);
      //
      // if (usdcBalance === 0n) {
      //   this.log(`\n${chalk.yellow("  No USDC in wallet.")}`);
      //   this.log(`  Send USDC on Base to: ${chalk.cyan(billing.address)}`);
      //   this.log(`  Then re-run: ${chalk.cyan("ecloud billing top-up")}\n`);
      //   return;
      // }

      // ── Step 3: Prompt for amount ──
      const amountStr = flags.amount ?? await input({
        message: "How much USDC to spend on credits?",
        validate: (val) => {
          const n = parseFloat(val);
          if (isNaN(n) || n <= 0) return "Enter a positive number";
          return true;
        },
      });

      const amountFloat = parseFloat(amountStr);
      // USDC has 6 decimals
      const amountRaw = BigInt(Math.round(amountFloat * 1e6));

      this.log(`\n  Purchasing ${chalk.bold(`$${amountFloat.toFixed(2)}`)} in credits...`);

      // ── Step 4: Approve USDC spend ──
      // The USDCCredits contract needs approval to transfer USDC on behalf of the user.
      //
      // TODO: Wire up when Base RPC + contract address are available.
      // const walletClient = ... (from billing client's wallet, pointed at Base RPC)
      //
      // this.log(chalk.gray("  Approving USDC spend..."));
      // const approveTx = await walletClient.writeContract({
      //   address: USDC_TOKEN_ADDRESS,
      //   abi: ERC20_APPROVE_ABI,
      //   functionName: "approve",
      //   args: [USDC_CREDITS_CONTRACT, amountRaw],
      // });
      // await publicClient.waitForTransactionReceipt({ hash: approveTx });
      // this.log(`  ${chalk.green("✓")} Approved`);

      // ── Step 5: Call purchaseCreditsFor(amount, account) ──
      // account = billing.address (purchasing credits for yourself)
      // For agent kit: account = appID (purchasing credits for an agent)
      //
      // this.log(chalk.gray("  Submitting credit purchase..."));
      // const purchaseTx = await walletClient.writeContract({
      //   address: USDC_CREDITS_CONTRACT,
      //   abi: USDC_CREDITS_ABI,
      //   functionName: "purchaseCreditsFor",
      //   args: [amountRaw, billing.address],
      // });
      // const receipt = await publicClient.waitForTransactionReceipt({ hash: purchaseTx });
      // this.log(`  ${chalk.green("✓")} Transaction confirmed: ${receipt.transactionHash}`);

      // ── Step 6: Poll billing API for credit confirmation ──
      // The billing API's chain indexer picks up the Deposit event and converts it
      // to Stripe credits. Poll getStatus until remainingCredits increases.
      //
      // this.log(chalk.gray("\n  Waiting for credits to appear..."));
      // const startTime = Date.now();
      // while (Date.now() - startTime < POLL_TIMEOUT_MS) {
      //   await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      //   const status = await billing.getStatus({ productId: flags.product as "compute" });
      //   if (status.remainingCredits !== undefined &&
      //       (currentCredits === undefined || status.remainingCredits > currentCredits)) {
      //     this.log(`\n  ${chalk.green("✓")} Credits received! Balance: ${chalk.cyan(`$${status.remainingCredits.toFixed(2)}`)}`);
      //     if (currentCredits === undefined || currentCredits === 0) {
      //       this.log(`  ${chalk.gray("First purchase — up to $25 matched.")}`);
      //     }
      //     this.log();
      //     return;
      //   }
      // }
      // this.log(`\n  ${chalk.yellow("⚠")} Credits haven't appeared yet. This can take a few minutes.`);
      // this.log(`  ${chalk.gray("Check your balance:")} ecloud billing status\n`);

      // ── Stub output until contract is deployed ──
      this.log(chalk.yellow(`\n  ⚠ Credit purchase contract not yet deployed.`));
      this.log(`  Contract: ${chalk.cyan(USDC_CREDITS_CONTRACT)}`);
      this.log(`  Chain:    Base (${CHAIN_ID})`);
      this.log(`  Call:     ${chalk.dim("USDCCredits.purchaseCreditsFor(")}${amountRaw.toString()}${chalk.dim(`, ${billing.address})`)}`);
      this.log(`\n  ${chalk.gray("Once deployed, this command will execute the transaction directly.")}`);
      this.log(`  ${chalk.gray("Check your balance:")} ecloud billing status\n`);
    });
  }
}
