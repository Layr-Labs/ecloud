import chalk from "chalk";
import type { AccountCreditsResponse } from "@layr-labs/ecloud-sdk";

export interface FundsBlockInput {
  /** Environment name, for the Wallet header (e.g. "sepolia"). */
  env: string;
  /** The 3-way split; undefined when the read failed (→ fallback line). */
  credits?: AccountCreditsResponse;
  /** getStatus().remainingCredits, used only in degraded mode. */
  remainingCreditsFallback?: number;
  /** getStatus().nextCreditExpiry, used only in degraded mode. */
  nextCreditExpiryFallback?: number;
  /** Pre-formatted wallet ETH (e.g. "0.0"); undefined → omit the ETH line. */
  walletEthFormatted?: string;
  /** Pre-formatted wallet USDC (e.g. "0.00"); undefined → omit the USDC line. */
  walletUsdcFormatted?: string;
}

function expirySuffix(unixSeconds?: number): string {
  if (!unixSeconds) return "";
  return ` (expires ${new Date(unixSeconds * 1000).toLocaleDateString()})`;
}

/**
 * Build the "Credits (Stripe)" + "Wallet" lines for `billing status`.
 * Pure: no I/O, returns the lines to print.
 */
export function formatFundsBlock(input: FundsBlockInput): string[] {
  const lines: string[] = [];

  // --- Credits (Stripe) ---
  if (input.credits) {
    const c = input.credits;
    lines.push(`\n${chalk.bold("Credits (Stripe):")}`);
    lines.push(
      `  Promotional: ${chalk.cyan(`$${c.promotionalCredits.toFixed(2)}`)}${expirySuffix(
        c.nextPromotionalCreditExpiry,
      )}`,
    );
    lines.push(`  Paid:        ${chalk.cyan(`$${c.permanentCredits.toFixed(2)}`)}`);
    lines.push(`  Total:       ${chalk.cyan(`$${c.remainingCredits.toFixed(2)}`)}`);
    lines.push(
      chalk.gray("  (Stripe credits pay compute usage — separate from the on-chain wallet below)"),
    );
  } else {
    // Degraded: split unavailable → single line from getStatus().remainingCredits.
    const remaining = input.remainingCreditsFallback ?? 0;
    lines.push(
      `\n  Credit balance (Stripe): ${chalk.cyan(`$${remaining.toFixed(2)}`)}${expirySuffix(
        input.nextCreditExpiryFallback,
      )}`,
    );
    lines.push(chalk.gray("  (separate from on-chain wallet ETH/USDC)"));
  }

  // --- Wallet (on-chain) ---
  const hasEth = input.walletEthFormatted !== undefined;
  const hasUsdc = input.walletUsdcFormatted !== undefined;
  if (hasEth || hasUsdc) {
    lines.push(`\n${chalk.bold(`Wallet (${input.env}):`)}`);
    if (hasEth) {
      const note =
        Number(input.walletEthFormatted) === 0
          ? chalk.yellow("  (fund with ETH to pay deploy/upgrade gas)")
          : "";
      lines.push(`  ETH:  ${chalk.cyan(`${input.walletEthFormatted} ETH`)}${note}`);
    }
    if (hasUsdc) {
      lines.push(`  USDC: ${chalk.cyan(`${input.walletUsdcFormatted} USDC`)}`);
    }
  }

  return lines;
}
