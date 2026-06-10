import { describe, it, expect } from "vitest";
import { formatFundsBlock } from "../billingFormat";

const credits = {
  remainingCredits: 25,
  permanentCredits: 0,
  promotionalCredits: 25,
  nextPromotionalCreditExpiry: 1751328000, // 2025-07-01 UTC
};

describe("formatFundsBlock", () => {
  it("renders promotional (with expiry), paid, total, and wallet ETH+USDC", () => {
    const out = formatFundsBlock({
      env: "sepolia",
      credits,
      walletEthFormatted: "0.0",
      walletUsdcFormatted: "0.00",
    }).join("\n");
    expect(out).toContain("Credits (Stripe):");
    expect(out).toContain("Promotional:");
    expect(out).toContain("$25.00");
    expect(out).toContain("expires");
    expect(out).toContain("Paid:");
    expect(out).toContain("Total:");
    expect(out).toContain("separate from");
    expect(out).toContain("Wallet (sepolia):");
    expect(out).toContain("0.0 ETH");
    expect(out).toContain("0.00 USDC");
  });

  it("omits the expiry suffix when there is no promotional expiry", () => {
    const out = formatFundsBlock({
      env: "sepolia",
      credits: { ...credits, nextPromotionalCreditExpiry: 0 },
      walletEthFormatted: "0.0",
      walletUsdcFormatted: "0.00",
    }).join("\n");
    expect(out).toContain("Promotional:");
    expect(out).not.toContain("expires");
  });

  it("falls back to a single Stripe line when the split is unavailable", () => {
    const out = formatFundsBlock({
      env: "sepolia",
      credits: undefined,
      remainingCreditsFallback: 12.5,
      walletEthFormatted: "0.0",
      walletUsdcFormatted: "0.00",
    }).join("\n");
    expect(out).toContain("Credit balance (Stripe): $12.50");
    expect(out).not.toContain("Promotional:");
  });

  it("omits the USDC line when wallet USDC is unavailable", () => {
    const out = formatFundsBlock({
      env: "sepolia",
      credits,
      walletEthFormatted: "0.0",
      walletUsdcFormatted: undefined,
    }).join("\n");
    expect(out).toContain("0.0 ETH");
    expect(out).not.toContain("USDC");
  });

  it("omits the ETH line when wallet ETH is unavailable", () => {
    const out = formatFundsBlock({
      env: "sepolia",
      credits,
      walletEthFormatted: undefined,
      walletUsdcFormatted: "0.00",
    }).join("\n");
    expect(out).not.toContain("ETH");
    expect(out).toContain("0.00 USDC");
  });

  it("omits the entire Wallet block when neither ETH nor USDC is available", () => {
    const out = formatFundsBlock({
      env: "sepolia",
      credits,
    }).join("\n");
    expect(out).not.toContain("Wallet (");
  });

  it("shows the fund-with-ETH note for any zero-valued ETH string", () => {
    for (const z of ["0", "0.0", "0.00", "0.000000000000000000"]) {
      const out = formatFundsBlock({
        env: "sepolia",
        credits,
        walletEthFormatted: z,
        walletUsdcFormatted: "0.00",
      }).join("\n");
      expect(out).toContain("fund with ETH");
    }
  });

  it("does NOT show the fund-with-ETH note when ETH is non-zero", () => {
    const out = formatFundsBlock({
      env: "sepolia",
      credits,
      walletEthFormatted: "1.5",
      walletUsdcFormatted: "0.00",
    }).join("\n");
    expect(out).toContain("1.5 ETH");
    expect(out).not.toContain("fund with ETH");
  });
});

import { formatLineItem } from "../billingFormat";

describe("formatLineItem", () => {
  const base = { currency: "usd" };

  it("parses the SKU from the API description and uses structured numerics", () => {
    const line = formatLineItem(
      { ...base, description: "0 × Pro 1 (at $0.07395890411 / month)", price: 0.07395890411, quantity: 0, subtotal: 0 },
      "Compute",
    );
    expect(line).toContain("Compute (Pro 1)");
    expect(line).toContain("$0.00");
    // API price is the hourly rate (matches the published pricing table),
    // despite the description text saying "/ month".
    expect(line).toContain("0 hours × $0.074/hour");
    expect(line).not.toContain("month))");
  });

  it("handles a multi-word SKU", () => {
    const line = formatLineItem(
      { ...base, description: "2 × Enterprise 1 (at $0.32875342466 / month)", price: 0.32875342466, quantity: 2, subtotal: 0.66 },
      "Compute",
    );
    expect(line).toContain("Compute (Enterprise 1)");
    expect(line).toContain("$0.66");
    expect(line).toContain("2 hours × $0.329/hour");
  });

  it("uses structured fields, not numbers embedded in the description", () => {
    const line = formatLineItem(
      { ...base, description: "0 × Starter 2 (at $9.99 / month)", price: 0.05, quantity: 7, subtotal: 1.23 },
      "Compute",
    );
    expect(line).toContain("Compute (Starter 2)");
    expect(line).toContain("$1.23");
    expect(line).toContain("7 hours × $0.050/hour");
    expect(line).not.toContain("9.99");
  });

  it("falls back to the raw description when the format does not match", () => {
    const line = formatLineItem(
      { ...base, description: "weird unparseable format", price: 0.1, quantity: 1, subtotal: 0.1 },
      "Compute",
    );
    expect(line).toContain("weird unparseable format");
    expect(line).not.toContain("Compute (");
  });
});

import { formatEthDisplay } from "../billingFormat";

describe("formatEthDisplay", () => {
  it("rounds to at most 4 decimal places (the most significant)", () => {
    expect(formatEthDisplay(98925371351956974n)).toBe("0.0989"); // 0.098925371351956974
  });
  it("strips trailing zeros (up to 4 dp, not padded)", () => {
    expect(formatEthDisplay(1500000000000000000n)).toBe("1.5"); // 1.5 ETH
    expect(formatEthDisplay(1000000000000000000n)).toBe("1");   // 1 ETH
  });
  it("renders exact zero as '0' (keeps the fund-with-ETH note firing)", () => {
    expect(formatEthDisplay(0n)).toBe("0");
  });
  it("rounds sub-0.0001 dust down to '0'", () => {
    expect(formatEthDisplay(100000000000n)).toBe("0"); // 0.0000001 ETH
  });
});
