import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../client", () => ({
  createBillingClient: vi.fn(),
}));

vi.mock("../../../telemetry", () => ({
  withTelemetry: vi.fn((_cmd: unknown, fn: () => Promise<void>) => fn()),
}));

vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
}));

import { createBillingClient } from "../../../client";
import { input } from "@inquirer/prompts";

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
    (input as ReturnType<typeof vi.fn>).mockResolvedValue("50");
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

  it("shows wallet address and prompts for amount", async () => {
    mockBilling.getStatus.mockResolvedValue({ subscriptionStatus: "inactive" });

    const output = await runCommand();
    const fullOutput = output.join("\n");

    expect(fullOutput).toContain("0x1234567890abcdef1234567890abcdef12345678");
    expect(input).toHaveBeenCalled();
  });

  it("uses --amount flag when provided (skips prompt)", async () => {
    mockBilling.getStatus.mockResolvedValue({ subscriptionStatus: "inactive" });

    const output = await runCommand({ amount: "100" });
    const fullOutput = output.join("\n");

    expect(input).not.toHaveBeenCalled();
    expect(fullOutput).toContain("$100.00");
  });

  it("shows the purchaseCreditsFor call with correct amount", async () => {
    mockBilling.getStatus.mockResolvedValue({ subscriptionStatus: "inactive" });

    const output = await runCommand({ amount: "50" });
    const fullOutput = output.join("\n");

    // 50 USDC = 50000000 (6 decimals)
    expect(fullOutput).toContain("purchaseCreditsFor");
    expect(fullOutput).toContain("50000000");
  });

  it("shows current credit balance when available", async () => {
    mockBilling.getStatus.mockResolvedValue({
      subscriptionStatus: "active",
      remainingCredits: 42.5,
    });

    const output = await runCommand({ amount: "25" });
    const fullOutput = output.join("\n");

    expect(fullOutput).toContain("$42.50");
  });

  it("does not fail if status check errors", async () => {
    mockBilling.getStatus.mockRejectedValue(new Error("API unavailable"));

    const output = await runCommand({ amount: "50" });
    const fullOutput = output.join("\n");

    expect(fullOutput).toContain("purchaseCreditsFor");
  });

  it("shows the user's address as the account argument", async () => {
    mockBilling.getStatus.mockResolvedValue({ subscriptionStatus: "inactive" });

    const output = await runCommand({ amount: "10" });
    const fullOutput = output.join("\n");

    expect(fullOutput).toContain("0x1234567890abcdef1234567890abcdef12345678");
    expect(fullOutput).toContain("purchaseCreditsFor");
  });
});
