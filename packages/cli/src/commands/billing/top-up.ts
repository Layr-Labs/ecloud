/**
 * ecloud billing top-up — Purchase EigenCompute credits with USDC, credit card, or x402
 *
 * Executes USDCCredits.purchaseCreditsFor(amount, account) on-chain via the SDK
 * billing module's topUp() method (EIP-7702 batched transaction), initiates
 * credit card checkout via the purchaseCredits API, or settles x402 payment over HTTP.
 *
 * Flow:
 *   1. Check current credit balance
 *   2. Prompt for payment method (USDC, card, or x402)
 *   3. USDC: Read wallet's USDC balance via SDK → prompt for amount → SDK topUp() → poll
 *   4. Card: Prompt for amount → check existing payment methods → purchaseCredits API → poll
 *   5. x402: resolve target (creator default / --creator / --app) → POST to platform endpoint → sign 402 challenge → settle
 */

import { Command, Flags } from "@oclif/core";
import { createBillingClient } from "../../client";
import { commonFlags } from "../../flags";
import { type Address, type Hex, formatUnits } from "viem";
import chalk from "chalk";
import { input, select } from "@inquirer/prompts";
import open from "open";
import { withTelemetry } from "../../telemetry";
import { type BillingChain, getEnvironmentConfig, requirePrivateKey, addHexPrefix } from "@layr-labs/ecloud-sdk";
import { privateKeyToAccount } from "viem/accounts";
import { purchaseCreditsX402 } from "../../x402/client";

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

/** Resolve the x402 credit target. `--app` and `--creator` are mutually exclusive. */
export function resolveX402Target(
  flags: { creator?: string; app?: string },
  walletAddress: string,
): { type: "app" | "creator"; address: string } {
  if (flags.app && flags.creator) {
    throw new Error("--app and --creator are mutually exclusive");
  }
  if (flags.app) return { type: "app", address: flags.app };
  if (flags.creator) return { type: "creator", address: flags.creator };
  return { type: "creator", address: walletAddress };
}

/** Build the x402 credit-purchase endpoint URL for a target. */
export function buildX402Url(
  baseUrl: string,
  target: { type: "app" | "creator"; address: string },
): string {
  const base = baseUrl.replace(/\/+$/, "");
  const segment = target.type === "app" ? "apps" : "creators";
  return `${base}/${segment}/${target.address}/x402-credits`;
}

/** Resolve the platform API base URL: --api-url → ECLOUD_API_URL → env config. */
export function resolveX402BaseUrl(
  flags: { "api-url"?: string },
  environment: string,
): string {
  const fromFlag = flags["api-url"]; // also bound to ECLOUD_API_URL via the flag's env
  if (fromFlag) return fromFlag.replace(/\/+$/, "");
  const fromEnvVar = process.env.ECLOUD_API_URL;
  if (fromEnvVar) return fromEnvVar.replace(/\/+$/, "");
  const fromConfig = getEnvironmentConfig(environment).platformApiURL;
  if (fromConfig) return fromConfig.replace(/\/+$/, "");
  throw new Error(
    `No platform API URL configured for environment "${environment}"; pass --api-url ` +
      `or set ECLOUD_API_URL.`,
  );
}

export default class BillingTopUp extends Command {
  static description = "Purchase EigenCompute credits with USDC, credit card, or x402";

  static examples = [
    "<%= config.bin %> billing top-up",
    "<%= config.bin %> billing top-up --method usdc --amount 50",
    "<%= config.bin %> billing top-up --method card --amount 25",
    "<%= config.bin %> billing top-up --method x402 --amount 50",
    "<%= config.bin %> billing top-up --method x402 --amount 50 --app 0xApp...",
    "<%= config.bin %> billing top-up --method x402 --amount 50 --creator 0xCreator...",
  ];

  static flags = {
    ...commonFlags,
    method: Flags.string({
      required: false,
      description: "Payment method: usdc (on-chain), card (credit card), or x402 (USDC over x402)",
      options: ["usdc", "card", "x402"],
    }),
    amount: Flags.string({
      required: false,
      description: "Amount to spend (USDC for on-chain, whole dollars for card)",
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
    chain: Flags.string({
      required: false,
      description: "Blockchain network for USDC payment: ethereum or base",
      options: ["ethereum", "base"],
    }),
    creator: Flags.string({
      required: false,
      description: "x402: creator address to credit (defaults to your wallet). Mutually exclusive with --app.",
    }),
    app: Flags.string({
      required: false,
      description: "x402: app address to credit. Mutually exclusive with --creator.",
    }),
    "api-url": Flags.string({
      required: false,
      description: "x402: override the platform API base URL",
      env: "ECLOUD_API_URL",
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(BillingTopUp);

      const billing = await createBillingClient(flags);
      const walletAddress = billing.address;
      const targetAccount = (flags.account as Address) ?? walletAddress;

      this.log(`\n${chalk.bold("Purchase EigenCompute credits")}`);
      this.log(`${chalk.gray("─".repeat(45))}`);
      this.log(`\n  ${chalk.bold("Wallet:")}  ${walletAddress}`);
      if (targetAccount !== walletAddress) {
        this.log(`  ${chalk.bold("Target:")}  ${targetAccount}`);
      }

      // Show current credit balance
      let baselineTotal: number | undefined;
      try {
        const status = await billing.getStatus({
          productId: flags.product as "compute",
        });
        const remaining = status.remainingCredits ?? 0;
        const applied = status.creditsApplied ?? 0;
        baselineTotal = remaining + applied;
        this.log(`  ${chalk.bold("Credits:")} ${chalk.cyan(`$${remaining.toFixed(2)}`)}`);
      } catch {
        this.debug("Could not fetch current credit balance");
      }

      // Select payment method
      const method =
        flags.method ??
        (await select({
          message: "How would you like to pay?",
          choices: [
            { value: "card", name: "Credit card" },
            { value: "usdc", name: "USDC (on-chain)" },
            { value: "x402", name: "USDC (x402)" },
          ],
        }));

      if (method === "usdc") {
        await this.handleUsdc(billing, flags, walletAddress, targetAccount, baselineTotal);
      } else if (method === "x402") {
        await this.handleX402(billing, flags, walletAddress, baselineTotal);
      } else {
        await this.handleCard(billing, flags, baselineTotal);
      }
    });
  }

  private async handleUsdc(
    billing: Awaited<ReturnType<typeof createBillingClient>>,
    flags: Record<string, any>,
    walletAddress: Address,
    targetAccount: Address,
    baselineTotal: number | undefined,
  ) {
    let selectedChain: BillingChain = "ethereum";

    if (billing.hasBaseSupport()) {
      selectedChain =
        (flags.chain as BillingChain) ??
        (await select({
          message: "Which network?",
          choices: [
            { value: "ethereum", name: "Ethereum" },
            { value: "base", name: "Base" },
          ],
        }));
    }

    const onChainState = await billing.getTopUpInfo({ chain: selectedChain });
    const { usdcBalance, minimumPurchase } = onChainState;

    const balanceFormatted = formatUnits(usdcBalance, 6);
    this.log(`  ${chalk.bold("USDC:")}    ${balanceFormatted} USDC`);

    if (usdcBalance === BigInt(0)) {
      const networkName = selectedChain === "base" ? "Base Sepolia" : "Sepolia";
      this.log(`\n${chalk.yellow("  No USDC in wallet.")}`);
      this.log(`  Send USDC on ${networkName} to: ${chalk.cyan(walletAddress)}`);
      this.log(`  Then re-run: ${chalk.cyan("ecloud billing top-up")}\n`);
      return;
    }

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

    const { txHash } = await billing.topUp({
      amount: amountRaw,
      account: targetAccount,
      chain: selectedChain,
    });
    this.log(`  ${chalk.green("✓")} Transaction confirmed: ${txHash}`);

    await this.pollForCredits(billing, flags, baselineTotal, amountFloat);
  }

  private async handleCard(
    billing: Awaited<ReturnType<typeof createBillingClient>>,
    flags: Record<string, any>,
    baselineTotal: number | undefined,
  ) {
    const MINIMUM_DOLLARS = 5;

    // Prompt for amount
    const amountStr =
      flags.amount ??
      (await input({
        message: `How many dollars of credits to purchase? (minimum: $${MINIMUM_DOLLARS})`,
        validate: (val) => {
          const n = parseInt(val, 10);
          if (isNaN(n) || n <= 0) return "Enter a positive whole number";
          if (n.toString() !== val.trim()) return "Enter a whole dollar amount (no cents)";
          if (n < MINIMUM_DOLLARS) return `Minimum purchase is $${MINIMUM_DOLLARS}`;
          return true;
        },
      }));

    const dollars = parseInt(amountStr, 10);
    if (isNaN(dollars) || dollars < MINIMUM_DOLLARS) {
      this.error(`Minimum purchase is $${MINIMUM_DOLLARS}`);
    }
    const amountCents = dollars * 100;

    // Check for existing payment methods
    const { paymentMethods } = await billing.getPaymentMethods();

    let paymentMethodId: string | undefined;

    if (paymentMethods.length > 0) {
      const choices = paymentMethods.map((card) => ({
        value: card.id,
        name: `${card.brand.charAt(0).toUpperCase() + card.brand.slice(1)} ending in ${card.last4}`,
      }));
      choices.push({ value: "new", name: "Add a new card" });

      const selection = await select({
        message: "Which card would you like to use?",
        choices,
      });

      if (selection !== "new") {
        paymentMethodId = selection;
      }
    }

    this.log(`\n  Purchasing ${chalk.bold(`$${dollars}`)} in credits...`);

    const result = await billing.purchaseCredits(amountCents, paymentMethodId);

    if (result.checkoutUrl) {
      this.log(`\n  ${chalk.cyan(result.checkoutUrl)}`);
      this.log(chalk.gray("  Opening checkout in browser..."));
      await open(result.checkoutUrl);
    } else if (result.checkoutSessionId) {
      this.error(
        "Checkout session created but no URL was returned. Please contact support.",
      );
    } else {
      this.log(`  ${chalk.green("✓")} Payment submitted`);
    }

    await this.pollForCredits(billing, flags, baselineTotal, dollars);
  }

  private async handleX402(
    billing: Awaited<ReturnType<typeof createBillingClient>>,
    flags: Record<string, any>,
    walletAddress: Address,
    baselineTotal: number | undefined,
  ) {
    const MINIMUM_DOLLARS = 5;

    const target = resolveX402Target(
      { creator: flags.creator, app: flags.app },
      walletAddress,
    );
    const baseUrl = resolveX402BaseUrl({ "api-url": flags["api-url"] }, flags.environment);
    const url = buildX402Url(baseUrl, target);

    // Amount (interactive when --amount is absent), whole dollars, min $5.
    const amountStr =
      flags.amount ??
      (await input({
        message: `How many dollars of credits to purchase? (minimum: $${MINIMUM_DOLLARS})`,
        validate: (val) => {
          const n = parseInt(val, 10);
          if (isNaN(n) || n <= 0) return "Enter a positive whole number";
          if (n.toString() !== val.trim()) return "Enter a whole dollar amount (no cents)";
          if (n < MINIMUM_DOLLARS) return `Minimum purchase is $${MINIMUM_DOLLARS}`;
          return true;
        },
      }));

    const dollars = parseInt(amountStr, 10);
    if (isNaN(dollars) || dollars < MINIMUM_DOLLARS) {
      this.error(`Minimum purchase is $${MINIMUM_DOLLARS}`);
    }
    const amountCents = dollars * 100;

    if (target.type === "app") {
      this.log(`  ${chalk.bold("Crediting app:")} ${target.address}`);
    } else if (target.address !== walletAddress) {
      this.log(`  ${chalk.bold("Crediting creator:")} ${target.address}`);
    }

    // Build the x402 signer from the same private key the billing client uses.
    const { key } = await requirePrivateKey({ privateKey: flags["private-key"] });
    const account = privateKeyToAccount(addHexPrefix(key) as Hex);

    this.log(`\n  Purchasing ${chalk.bold(`$${dollars}`)} in credits over x402...`);

    const result = await purchaseCreditsX402({
      url,
      amountCents,
      account,
      verbose: flags.verbose,
    });

    this.log(`  ${chalk.green("✓")} x402 payment settled`);
    this.log(`  ${chalk.bold("Transaction:")} ${result.txHash}`);
    this.log(`  ${chalk.bold("Payment ID:")}  ${result.paymentId}`);
    this.log(
      `  ${chalk.bold("Credits added:")} ${chalk.cyan(`$${(result.creditedCents / 100).toFixed(2)}`)}`,
    );

    // Poll only when crediting our own account — otherwise our balance won't move.
    if (target.address.toLowerCase() === walletAddress.toLowerCase()) {
      await this.pollForCredits(billing, flags, baselineTotal, dollars);
    } else {
      this.log(
        `\n  Credits applied to ${target.type} ${target.address}. ` +
          `Check that account's balance with: ecloud billing status\n`,
      );
    }
  }

  private async pollForCredits(
    billing: Awaited<ReturnType<typeof createBillingClient>>,
    flags: Record<string, any>,
    baselineTotal: number | undefined,
    amountPurchased: number,
  ) {
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
        this.debug(
          `Poll: remaining=${remaining}, applied=${applied}, total=${currentTotal}, baseline=${baselineTotal}`,
        );
        if (baselineTotal === undefined || currentTotal > baselineTotal) {
          const creditsAdded =
            baselineTotal !== undefined ? currentTotal - baselineTotal : undefined;
          this.log(
            `\n  ${chalk.green("✓")} Credits received: ${chalk.cyan(`$${(creditsAdded ?? amountPurchased).toFixed(2)}`)}`,
          );
          if (remaining > 0) {
            this.log(`  Remaining balance: ${chalk.cyan(`$${remaining.toFixed(2)}`)}`);
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
  }
}
