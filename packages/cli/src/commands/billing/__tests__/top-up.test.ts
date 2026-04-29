import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../client", () => ({
  createBillingClient: vi.fn(),
}));

vi.mock("../../../telemetry", () => ({
  withTelemetry: vi.fn((_cmd: unknown, fn: () => Promise<void>) => fn()),
}));

vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
}));

import BillingTopUp from "../top-up";
import { createBillingClient } from "../../../client";
import { input } from "@inquirer/prompts";

const WALLET_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const TX_HASH = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

describe("ecloud billing top-up", () => {
  let logOutput: string[];
  let mockBilling: {
    address: string;
    getStatus: ReturnType<typeof vi.fn>;
    getTopUpInfo: ReturnType<typeof vi.fn>;
    topUp: ReturnType<typeof vi.fn>;
    redeemCode: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    logOutput = [];
    mockBilling = {
      address: WALLET_ADDRESS,
      getStatus: vi.fn(),
      getTopUpInfo: vi.fn(),
      topUp: vi.fn(),
      redeemCode: vi.fn(),
    };
    (createBillingClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockBilling);

    (input as ReturnType<typeof vi.fn>).mockResolvedValue("50");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setupOnChainState(overrides: {
    usdcAddress?: string;
    minimumPurchase?: bigint;
    usdcBalance?: bigint;
    currentAllowance?: bigint;
  } = {}) {
    const {
      usdcAddress = "0xUSDCAddress0000000000000000000000000000",
      minimumPurchase = BigInt(1_000_000), // 1 USDC
      usdcBalance = BigInt(100_000_000), // 100 USDC
      currentAllowance = BigInt(0),
    } = overrides;

    mockBilling.getTopUpInfo.mockResolvedValue({
      usdcAddress,
      minimumPurchase,
      usdcBalance,
      currentAllowance,
    });
  }

  function createCommand(flags: Record<string, unknown> = {}) {
    const cmd = new BillingTopUp([], {} as any);
    cmd.parse = vi.fn().mockResolvedValue({
      flags: {
        product: "compute",
        "private-key": "0xdeadbeef",
        environment: "sepolia-dev",
        ...flags,
      },
    });
    cmd.log = vi.fn((...args: string[]) => logOutput.push(args.join(" ")));
    cmd.debug = vi.fn();
    cmd.error = vi.fn((msg: string) => {
      throw new Error(msg);
    }) as any;
    return cmd;
  }

  it("happy path: sufficient balance, purchase succeeds", async () => {
    setupOnChainState();
    mockBilling.topUp.mockResolvedValue({ txHash: TX_HASH, walletAddress: WALLET_ADDRESS });
    mockBilling.getStatus
      .mockResolvedValueOnce({ subscriptionStatus: "active", remainingCredits: 10.0 })
      .mockResolvedValueOnce({ subscriptionStatus: "active", remainingCredits: 60.0 });

    const cmd = createCommand({ amount: "50" });
    const promise = cmd.run();
    // Advance timers to resolve the polling setTimeout
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(5_000);
    }
    await promise;
    const fullOutput = logOutput.join("\n");

    // Shows wallet address
    expect(fullOutput).toContain(WALLET_ADDRESS);
    // Shows credits
    expect(fullOutput).toContain("$10.00");
    // Shows USDC balance
    expect(fullOutput).toContain("100 USDC");
    // Shows purchase step
    expect(fullOutput).toContain("Purchasing");
    expect(fullOutput).toContain("Transaction confirmed");
    // Shows final balance after polling
    expect(fullOutput).toContain("Credits received");
    expect(fullOutput).toContain("$60.00");

    // Verify topUp was called with correct args
    expect(mockBilling.topUp).toHaveBeenCalledWith({
      amount: BigInt(50_000_000),
      account: WALLET_ADDRESS,
    });
  });

  it("zero USDC balance: exits with fund wallet message", async () => {
    setupOnChainState({ usdcBalance: BigInt(0) });
    mockBilling.getStatus.mockResolvedValue({ subscriptionStatus: "inactive" });

    const cmd = createCommand({ amount: "50" });
    await cmd.run();
    const fullOutput = logOutput.join("\n");

    expect(fullOutput).toContain("No USDC in wallet");
    expect(fullOutput).toContain("Send USDC on Sepolia to");
    expect(fullOutput).toContain(WALLET_ADDRESS);

    // Should not have called topUp
    expect(mockBilling.topUp).not.toHaveBeenCalled();
  });

  it("below minimum purchase: shows error", async () => {
    setupOnChainState({ minimumPurchase: BigInt(10_000_000) }); // 10 USDC minimum
    mockBilling.getStatus.mockResolvedValue({ subscriptionStatus: "inactive" });

    const cmd = createCommand({ amount: "5" });
    await expect(cmd.run()).rejects.toThrow("Minimum purchase is 10 USDC");
  });

  it("--account flag: passes different address to topUp", async () => {
    const targetAccount = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    setupOnChainState();
    mockBilling.topUp.mockResolvedValue({ txHash: TX_HASH, walletAddress: WALLET_ADDRESS });
    mockBilling.getStatus
      .mockResolvedValueOnce({ subscriptionStatus: "active", remainingCredits: 10.0 })
      .mockResolvedValueOnce({ subscriptionStatus: "active", remainingCredits: 60.0 });

    const cmd = createCommand({ amount: "50", account: targetAccount });
    const promise = cmd.run();
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(5_000);
    }
    await promise;
    const fullOutput = logOutput.join("\n");

    // Shows target account
    expect(fullOutput).toContain(targetAccount);

    // Verify topUp was called with the target account
    expect(mockBilling.topUp).toHaveBeenCalledWith({
      amount: BigInt(50_000_000),
      account: targetAccount,
    });
  });

  it("billing API poll timeout: shows timeout message", async () => {
    setupOnChainState();
    mockBilling.topUp.mockResolvedValue({ txHash: TX_HASH, walletAddress: WALLET_ADDRESS });
    // getStatus always returns the same credits (no increase)
    mockBilling.getStatus.mockResolvedValue({
      subscriptionStatus: "active",
      remainingCredits: 10.0,
    });

    const cmd = createCommand({ amount: "50" });
    const promise = cmd.run();
    // Advance past the 3-minute poll timeout
    await vi.advanceTimersByTimeAsync(200_000);
    await promise;
    const fullOutput = logOutput.join("\n");

    expect(fullOutput).toContain("Credits haven't appeared yet");
    expect(fullOutput).toContain("ecloud billing status");
  });

  it("uses --amount flag when provided (skips prompt)", async () => {
    setupOnChainState();
    mockBilling.topUp.mockResolvedValue({ txHash: TX_HASH, walletAddress: WALLET_ADDRESS });
    mockBilling.getStatus
      .mockResolvedValueOnce({ subscriptionStatus: "inactive" })
      .mockResolvedValueOnce({ subscriptionStatus: "active", remainingCredits: 100.0 });

    const cmd = createCommand({ amount: "100" });
    const promise = cmd.run();
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(5_000);
    }
    await promise;

    expect(input).not.toHaveBeenCalled();
  });

  it("does not fail if status check errors", async () => {
    setupOnChainState();
    mockBilling.topUp.mockResolvedValue({ txHash: TX_HASH, walletAddress: WALLET_ADDRESS });
    mockBilling.getStatus.mockRejectedValue(new Error("API unavailable"));

    const cmd = createCommand({ amount: "50" });
    const promise = cmd.run();
    // Advance past poll timeout since getStatus always errors
    await vi.advanceTimersByTimeAsync(200_000);
    await promise;
    const fullOutput = logOutput.join("\n");

    // Should still proceed with on-chain purchase
    expect(fullOutput).toContain("Purchasing");
    expect(fullOutput).toContain("Transaction confirmed");
    // Will timeout on polling since status always errors
    expect(fullOutput).toContain("Credits haven't appeared yet");
  });

  it("--code: happy path prints granted amount and new balance", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 90 * 24 * 3600;
    mockBilling.redeemCode.mockResolvedValue({
      code: "LAUNCH50",
      grantedAmount: 50,
      remainingCredits: 55,
      expiresAt,
    });

    const cmd = createCommand({ code: "LAUNCH50" });
    await cmd.run();
    const fullOutput = logOutput.join("\n");

    expect(mockBilling.redeemCode).toHaveBeenCalledWith({ code: "LAUNCH50", productId: "compute" });
    expect(fullOutput).toContain("Redeem promotion code");
    expect(fullOutput).toContain("LAUNCH50");
    expect(fullOutput).toContain("$50.00");
    expect(fullOutput).toContain("$55.00");
    // USDC flow must not run
    expect(mockBilling.getTopUpInfo).not.toHaveBeenCalled();
    expect(mockBilling.topUp).not.toHaveBeenCalled();
  });

  it("--code: surfaces friendly error on 404", async () => {
    mockBilling.redeemCode.mockRejectedValue(new Error("BillingAPI request failed: 404 Error - Promotion code not found or inactive"));

    const cmd = createCommand({ code: "BADCODE" });
    await expect(cmd.run()).rejects.toThrow(/not valid|inactive|already redeemed/i);
    expect(mockBilling.topUp).not.toHaveBeenCalled();
  });
});
