import chalk from "chalk";
import { formatEther } from "viem";
import type { AccountCreditsResponse, SubscriptionLineItem } from "@layr-labs/ecloud-sdk";

/**
 * Format a wei balance as ETH for display: the 18-decimal raw value is noise,
 * so round to at most 4 decimal places (enough to judge gas) and strip trailing
 * zeros. Exact zero renders as "0" (which keeps the "fund with ETH" hint firing,
 * since a sub-0.0001 dust balance also rounds to "0" and can't pay gas anyway).
 */
export function formatEthDisplay(wei: bigint): string {
  const eth = Number(formatEther(wei));
  // toFixed(4) then drop trailing zeros and any dangling decimal point.
  return eth.toFixed(4).replace(/\.?0+$/, "");
}

/**
 * Render one subscription line item as a display line.
 *
 * The API description has the form "<qty> × <SKU> (at $<price> / month)" — the
 * SKU name (e.g. "Pro 1") lives only in that string, so we parse it out, but
 * the quantity/price/subtotal come from the structured fields (never parsed
 * from the text). If the description doesn't match the expected shape, fall
 * back to printing it verbatim rather than rendering garbage.
 *
 * NOTE on units: the API `price` is the *hourly* rate (e.g. Pro 1 = $0.074/hr,
 * per the published pricing table), and `quantity` is metered hours — despite
 * the description string mislabeling the rate "/ month". We render /hour to
 * match the authoritative pricing, not the description's text.
 */
export function formatLineItem(item: SubscriptionLineItem, productLabel: string): string {
  const match = item.description.match(/×\s*(.+?)\s*\(at\b/);
  const sku = match?.[1]?.trim();
  const label = sku ? `${productLabel} (${sku})` : item.description;
  return `    • ${label}: $${item.subtotal.toFixed(2)} (${item.quantity} hours × $${item.price.toFixed(3)}/hour)`;
}

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
