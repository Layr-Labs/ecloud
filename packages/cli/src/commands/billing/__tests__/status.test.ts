import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../client", () => ({
  createBillingClient: vi.fn(),
}));

vi.mock("../../../telemetry", () => ({
  withTelemetry: vi.fn((_cmd: unknown, fn: () => Promise<void>) => fn()),
}));

import { createBillingClient } from "../../../client";

describe("ecloud billing status — top-up hint", () => {
  let logOutput: string[];
  let mockBilling: {
    address: string;
    getStatus: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    logOutput = [];
    mockBilling = {
      address: "0xabcdef1234567890abcdef1234567890abcdef12",
      getStatus: vi.fn(),
    };
    (createBillingClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockBilling);
  });

  async function runStatusCommand(statusResult: Record<string, unknown>) {
    const { default: BillingStatus } = await import("../status");
    mockBilling.getStatus.mockResolvedValue(statusResult);

    const cmd = new BillingStatus([], {} as any);
    cmd.parse = vi.fn().mockResolvedValue({
      flags: { product: "compute", verbose: false },
    });
    cmd.log = vi.fn((...args: string[]) => logOutput.push(args.join(" ")));
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
});
