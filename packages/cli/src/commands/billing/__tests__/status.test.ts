import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../client", () => ({
  createBillingClient: vi.fn(),
}));

vi.mock("../../../telemetry", () => ({
  withTelemetry: vi.fn((_cmd: unknown, fn: () => Promise<void>) => fn()),
}));

vi.mock("@layr-labs/ecloud-sdk", () => ({
  getEnvironmentConfig: vi.fn(() => ({ defaultRPCURL: "https://rpc.example" })),
}));

vi.mock("../../../utils/viemClients", () => ({
  createViemClients: vi.fn(),
}));

import { createBillingClient } from "../../../client";
import { createViemClients } from "../../../utils/viemClients";

describe("ecloud billing status — top-up hint", () => {
  let logOutput: string[];
  let mockBilling: {
    address: string;
    getStatus: ReturnType<typeof vi.fn>;
    getAccountCredits: ReturnType<typeof vi.fn>;
    getTopUpInfo: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    logOutput = [];
    warnOutput = [];
    mockBilling = {
      address: "0xabcdef1234567890abcdef1234567890abcdef12",
      getStatus: vi.fn(),
      getAccountCredits: vi.fn().mockResolvedValue({
        remainingCredits: 0,
        permanentCredits: 0,
        promotionalCredits: 0,
        nextPromotionalCreditExpiry: 0,
      }),
      getTopUpInfo: vi.fn().mockResolvedValue({ usdcBalance: 0n }),
    };
    (createBillingClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockBilling);
  });

  let warnOutput: string[];

  async function runStatusCommand(
    statusResult: Record<string, unknown>,
    flagOverrides: Record<string, unknown> = {},
  ) {
    const { default: BillingStatus } = await import("../status");
    mockBilling.getStatus.mockResolvedValue(statusResult);

    const cmd = new BillingStatus([], {} as any);
    cmd.parse = vi.fn().mockResolvedValue({
      flags: { product: "compute", verbose: false, ...flagOverrides },
    });
    cmd.log = vi.fn((...args: string[]) => logOutput.push(args.join(" ")));
    cmd.warn = vi.fn((msg: string | Error) => {
      warnOutput.push(typeof msg === "string" ? msg : msg.message);
      return msg as string & Error;
    });
    cmd.debug = vi.fn();

    await cmd.run();
    return logOutput;
  }

  it("shows top-up hint when subscription is inactive", async () => {
    const output = await runStatusCommand({
      subscriptionStatus: "inactive",
      productId: "compute",
    });
    const fullOutput = output.join("\n");

    expect(fullOutput).toContain("ecloud billing top-up");
    expect(fullOutput).toContain("Need more credits?");
  });

  it("shows top-up hint when credits are low (< $10)", async () => {
    const output = await runStatusCommand({
      subscriptionStatus: "active",
      productId: "compute",
      remainingCredits: 5.0,
    });
    const fullOutput = output.join("\n");

    expect(fullOutput).toContain("ecloud billing top-up");
  });

  it("does NOT show top-up hint when credits are healthy", async () => {
    const output = await runStatusCommand({
      subscriptionStatus: "active",
      productId: "compute",
      remainingCredits: 50.0,
      upcomingInvoiceTotal: 12.0,
    });
    const fullOutput = output.join("\n");

    expect(fullOutput).not.toContain("Need more credits?");
  });

  it("does NOT show top-up hint when subscription is active with no credit info", async () => {
    const output = await runStatusCommand({
      subscriptionStatus: "active",
      productId: "compute",
    });
    const fullOutput = output.join("\n");

    expect(fullOutput).not.toContain("Need more credits?");
  });

  describe("wallet ETH balance line", () => {
    it("warns (does not silently swallow) when the balance read fails, but still completes", async () => {
      (createViemClients as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("invalid private key");
      });

      const output = await runStatusCommand(
        { subscriptionStatus: "active", productId: "compute" },
        { "private-key": "0xbad", environment: "sepolia" },
      );

      // The command still finishes and prints the rest of the status.
      expect(output.join("\n")).toContain("Subscription Status:");
      // The failure reason is surfaced, not discarded.
      expect(warnOutput.join("\n")).toMatch(/wallet ETH|balance/i);
      expect(warnOutput.join("\n")).toContain("invalid private key");
    });

    it("prints the ETH line on a successful balance read", async () => {
      (createViemClients as ReturnType<typeof vi.fn>).mockReturnValue({
        publicClient: { getBalance: vi.fn().mockResolvedValue(1000000000000000000n) },
        address: "0xabcdef1234567890abcdef1234567890abcdef12",
      });

      const output = await runStatusCommand(
        { subscriptionStatus: "active", productId: "compute" },
        { "private-key": "0xgood", environment: "sepolia" },
      );

      expect(output.join("\n")).toMatch(/Wallet \(sepolia\):/);
      expect(output.join("\n")).toMatch(/ETH:\s+1 ETH/);
      expect(warnOutput).toHaveLength(0);
    });

    it("renders the promotional/paid credit split", async () => {
      (createViemClients as ReturnType<typeof vi.fn>).mockReturnValue({
        publicClient: { getBalance: vi.fn().mockResolvedValue(0n) },
        address: "0xabcdef1234567890abcdef1234567890abcdef12",
      });
      mockBilling.getAccountCredits.mockResolvedValue({
        remainingCredits: 25,
        permanentCredits: 0,
        promotionalCredits: 25,
        nextPromotionalCreditExpiry: 0,
      });
      const output = await runStatusCommand(
        { subscriptionStatus: "active", productId: "compute" },
        { "private-key": "0xgood", environment: "sepolia" },
      );
      const out = output.join("\n");
      expect(out).toContain("Credits (Stripe):");
      expect(out).toContain("Promotional:");
    });
  });
});
