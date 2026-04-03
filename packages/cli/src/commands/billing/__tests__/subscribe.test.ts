import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../client", () => ({
  createBillingClient: vi.fn(),
}));

vi.mock("../../../telemetry", () => ({
  withTelemetry: vi.fn((_cmd: unknown, fn: () => Promise<void>) => fn()),
}));

vi.mock("@inquirer/prompts", () => ({
  select: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("open", () => ({
  default: vi.fn(),
}));

import { createBillingClient } from "../../../client";
import { select } from "@inquirer/prompts";

describe("ecloud billing subscribe — payment method selection", () => {
  let logOutput: string[];
  let mockBilling: {
    address: string;
    subscribe: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
  };
  let runCommandCalls: Array<[string, string[]]>;

  beforeEach(() => {
    logOutput = [];
    runCommandCalls = [];
    mockBilling = {
      address: "0xabcdef1234567890abcdef1234567890abcdef12",
      subscribe: vi.fn(),
      getStatus: vi.fn(),
    };
    (createBillingClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockBilling);
  });

  async function runCommand(
    selectResponse: string,
    subscribeResult: Record<string, unknown> = { type: "checkout_created", checkoutUrl: "https://checkout.stripe.com/test" },
  ) {
    const { default: BillingSubscribe } = await import("../subscribe");
    (select as ReturnType<typeof vi.fn>).mockResolvedValue(selectResponse);
    mockBilling.subscribe.mockResolvedValue(subscribeResult);

    mockBilling.getStatus.mockResolvedValue({
      subscriptionStatus: "active",
    });

    const cmd = new BillingSubscribe([], {} as any);
    cmd.parse = vi.fn().mockResolvedValue({
      flags: { product: "compute", verbose: false },
    });
    cmd.log = vi.fn((...args: string[]) => logOutput.push(args.join(" ")));
    cmd.debug = vi.fn();
    cmd.config = {
      runCommand: vi.fn((...args: unknown[]) => {
        runCommandCalls.push(args as [string, string[]]);
        return Promise.resolve();
      }),
    } as any;

    await cmd.run();
    return logOutput;
  }

  it("presents CC and USDC as payment options", async () => {
    await runCommand("card");

    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("pay"),
        choices: expect.arrayContaining([
          expect.objectContaining({ value: "card" }),
          expect.objectContaining({ value: "usdc" }),
        ]),
      }),
    );
  });

  it("delegates to ecloud billing top-up when USDC is selected", async () => {
    await runCommand("usdc");

    expect(runCommandCalls.length).toBe(1);
    expect(runCommandCalls[0][0]).toBe("billing:top-up");
  });

  it("opens Stripe checkout when credit card is selected", async () => {
    const open = (await import("open")).default as ReturnType<typeof vi.fn>;

    await runCommand("card");

    expect(open).toHaveBeenCalledWith("https://checkout.stripe.com/test");
  });

  it("shows top-up hint during credit card checkout", async () => {
    await runCommand("card");
    const fullOutput = logOutput.join("\n");

    expect(fullOutput).toContain("ecloud billing top-up");
  });

  it("skips payment selection when subscription is already active", async () => {
    mockBilling.subscribe.mockResolvedValue({
      type: "already_active",
      status: "active",
    });

    const { default: BillingSubscribe } = await import("../subscribe");
    const cmd = new BillingSubscribe([], {} as any);
    cmd.parse = vi.fn().mockResolvedValue({
      flags: { product: "compute", verbose: false },
    });
    cmd.log = vi.fn((...args: string[]) => logOutput.push(args.join(" ")));
    cmd.debug = vi.fn();

    await cmd.run();

    expect(select).not.toHaveBeenCalled();
    const fullOutput = logOutput.join("\n");
    expect(fullOutput).toContain("already subscribed");
  });
});
