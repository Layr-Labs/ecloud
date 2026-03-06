import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../client", () => ({
  createBillingClient: vi.fn(),
}));

vi.mock("../../../telemetry", () => ({
  withTelemetry: vi.fn((_cmd: unknown, fn: () => Promise<void>) => fn()),
}));

import { createBillingClient } from "../../../client";

describe("ecloud billing top-up", () => {
  let logOutput: string[];
  let mockBilling: {
    address: string;
    getStatus: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    logOutput = [];
    mockBilling = {
      address: "0x1234567890abcdef1234567890abcdef12345678",
      getStatus: vi.fn(),
    };
    (createBillingClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockBilling);
  });

  async function runCommand(flags: Record<string, unknown> = {}) {
    const { default: BillingTopUp } = await import("../top-up");

    const cmd = new BillingTopUp([], {} as any);
    cmd.parse = vi.fn().mockResolvedValue({
      flags: { product: "compute", ...flags },
    });
    cmd.log = vi.fn((...args: string[]) => logOutput.push(args.join(" ")));
    cmd.debug = vi.fn();

    await cmd.run();
    return logOutput;
  }

  it("displays the credit purchase contract and chain", async () => {
    mockBilling.getStatus.mockResolvedValue({ subscriptionStatus: "inactive" });

    const output = await runCommand();
    const fullOutput = output.join("\n");

    expect(fullOutput).toContain("Contract:");
    expect(fullOutput).toContain("Chain:");
    expect(fullOutput).toContain("Base");
    expect(fullOutput).toContain("USDC");
  });

  it("displays the user's wallet address", async () => {
    mockBilling.getStatus.mockResolvedValue({ subscriptionStatus: "inactive" });

    const output = await runCommand();
    const fullOutput = output.join("\n");

    expect(fullOutput).toContain("0x1234567890abcdef1234567890abcdef12345678");
  });

  it("shows current credit balance when credits exist", async () => {
    mockBilling.getStatus.mockResolvedValue({
      subscriptionStatus: "active",
      remainingCredits: 42.5,
    });

    const output = await runCommand();
    const fullOutput = output.join("\n");

    expect(fullOutput).toContain("$42.50");
  });

  it("mentions the $25 match on first purchase", async () => {
    mockBilling.getStatus.mockResolvedValue({ subscriptionStatus: "inactive" });

    const output = await runCommand();
    const fullOutput = output.join("\n");

    expect(fullOutput).toContain("$25");
  });

  it("does not fail if status check errors", async () => {
    mockBilling.getStatus.mockRejectedValue(new Error("API unavailable"));

    const output = await runCommand();
    const fullOutput = output.join("\n");

    expect(fullOutput).toContain("Contract:");
  });

  it("includes non-refundable note", async () => {
    mockBilling.getStatus.mockResolvedValue({ subscriptionStatus: "inactive" });

    const output = await runCommand();
    const fullOutput = output.join("\n");

    expect(fullOutput).toContain("non-refundable");
  });

  it("references ecloud billing status for balance check", async () => {
    mockBilling.getStatus.mockResolvedValue({ subscriptionStatus: "inactive" });

    const output = await runCommand();
    const fullOutput = output.join("\n");

    expect(fullOutput).toContain("ecloud billing status");
  });
});
