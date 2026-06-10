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
