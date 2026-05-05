import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../client", () => ({
  createBillingClient: vi.fn(),
}));

vi.mock("../../../telemetry", () => ({
  withTelemetry: vi.fn((_cmd: unknown, fn: () => Promise<void>) => fn()),
}));

vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
  select: vi.fn(),
}));

vi.mock("open", () => ({
  default: vi.fn(),
}));

import BillingTopUp from "../top-up";
import { createBillingClient } from "../../../client";
import { input, select } from "@inquirer/prompts";

const WALLET_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const TX_HASH = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

describe("ecloud billing top-up", () => {
  let logOutput: string[];
  let mockBilling: {
    address: string;
    getStatus: ReturnType<typeof vi.fn>;
    getTopUpInfo: ReturnType<typeof vi.fn>;
    topUp: ReturnType<typeof vi.fn>;
    getPaymentMethods: ReturnType<typeof vi.fn>;
    purchaseCredits: ReturnType<typeof vi.fn>;
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
      getPaymentMethods: vi.fn(),
      purchaseCredits: vi.fn(),
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

  // ── USDC Tests ──

  it("happy path: sufficient balance, purchase succeeds", async () => {
    setupOnChainState();
    mockBilling.topUp.mockResolvedValue({ txHash: TX_HASH, walletAddress: WALLET_ADDRESS });
    mockBilling.getStatus
      .mockResolvedValueOnce({ subscriptionStatus: "active", remainingCredits: 10.0 })
      .mockResolvedValueOnce({ subscriptionStatus: "active", remainingCredits: 60.0 });

    const cmd = createCommand({ amount: "50", method: "usdc" });
    const promise = cmd.run();
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(5_000);
    }
    await promise;
    const fullOutput = logOutput.join("\n");

    expect(fullOutput).toContain(WALLET_ADDRESS);
    expect(fullOutput).toContain("$10.00");
    expect(fullOutput).toContain("100 USDC");
    expect(fullOutput).toContain("Purchasing");
    expect(fullOutput).toContain("Transaction confirmed");
    expect(fullOutput).toContain("Credits received");
    expect(fullOutput).toContain("$60.00");

    expect(mockBilling.topUp).toHaveBeenCalledWith({
      amount: BigInt(50_000_000),
      account: WALLET_ADDRESS,
    });
  });

  it("zero USDC balance: exits with fund wallet message", async () => {
    setupOnChainState({ usdcBalance: BigInt(0) });
    mockBilling.getStatus.mockResolvedValue({ subscriptionStatus: "inactive" });

    const cmd = createCommand({ amount: "50", method: "usdc" });
    await cmd.run();
    const fullOutput = logOutput.join("\n");

    expect(fullOutput).toContain("No USDC in wallet");
    expect(fullOutput).toContain("Send USDC on Sepolia to");
    expect(fullOutput).toContain(WALLET_ADDRESS);

    expect(mockBilling.topUp).not.toHaveBeenCalled();
  });

  it("below minimum purchase: shows error", async () => {
    setupOnChainState({ minimumPurchase: BigInt(10_000_000) }); // 10 USDC minimum
    mockBilling.getStatus.mockResolvedValue({ subscriptionStatus: "inactive" });

    const cmd = createCommand({ amount: "5", method: "usdc" });
    await expect(cmd.run()).rejects.toThrow("Minimum purchase is 10 USDC");
  });

  it("--account flag: passes different address to topUp", async () => {
    const targetAccount = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    setupOnChainState();
    mockBilling.topUp.mockResolvedValue({ txHash: TX_HASH, walletAddress: WALLET_ADDRESS });
    mockBilling.getStatus
      .mockResolvedValueOnce({ subscriptionStatus: "active", remainingCredits: 10.0 })
      .mockResolvedValueOnce({ subscriptionStatus: "active", remainingCredits: 60.0 });

    const cmd = createCommand({ amount: "50", method: "usdc", account: targetAccount });
    const promise = cmd.run();
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(5_000);
    }
    await promise;
    const fullOutput = logOutput.join("\n");

    expect(fullOutput).toContain(targetAccount);

    expect(mockBilling.topUp).toHaveBeenCalledWith({
      amount: BigInt(50_000_000),
      account: targetAccount,
    });
  });

  it("billing API poll timeout: shows timeout message", async () => {
    setupOnChainState();
    mockBilling.topUp.mockResolvedValue({ txHash: TX_HASH, walletAddress: WALLET_ADDRESS });
    mockBilling.getStatus.mockResolvedValue({
      subscriptionStatus: "active",
      remainingCredits: 10.0,
    });

    const cmd = createCommand({ amount: "50", method: "usdc" });
    const promise = cmd.run();
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

    const cmd = createCommand({ amount: "100", method: "usdc" });
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

    const cmd = createCommand({ amount: "50", method: "usdc" });
    const promise = cmd.run();
    await vi.advanceTimersByTimeAsync(200_000);
    await promise;
    const fullOutput = logOutput.join("\n");

    expect(fullOutput).toContain("Purchasing");
    expect(fullOutput).toContain("Transaction confirmed");
    expect(fullOutput).toContain("Credits haven't appeared yet");
  });

  // ── Credit Card Tests ──

  it("credit card: charges selected card on file", async () => {
    mockBilling.getStatus
      .mockResolvedValueOnce({ subscriptionStatus: "active", remainingCredits: 10.0 })
      .mockResolvedValueOnce({ subscriptionStatus: "active", remainingCredits: 35.0 });
    mockBilling.getPaymentMethods.mockResolvedValue({
      paymentMethods: [
        {
          id: "029641fc-3e5c-11f1-986c-5601121cbf6d",
          stripePaymentMethodId: "pm_1ABC1234",
          brand: "visa",
          last4: "1234",
          createdAt: "2026-04-20T15:00:00Z",
        },
        {
          id: "139752fd-4e6d-22f2-a97d-6712232dcg7e",
          stripePaymentMethodId: "pm_2DEF5678",
          brand: "mastercard",
          last4: "5678",
          createdAt: "2026-04-21T10:00:00Z",
        },
      ],
    });
    mockBilling.purchaseCredits.mockResolvedValue({
      purchaseId: "a1b2c3d4",
      amountCents: "2500",
    });
    (select as unknown as ReturnType<typeof vi.fn>).mockResolvedValue("029641fc-3e5c-11f1-986c-5601121cbf6d");

    const cmd = createCommand({ amount: "25", method: "card" });
    const promise = cmd.run();
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(5_000);
    }
    await promise;
    const fullOutput = logOutput.join("\n");

    expect(mockBilling.purchaseCredits).toHaveBeenCalledWith(2500, "029641fc-3e5c-11f1-986c-5601121cbf6d");
    expect(fullOutput).toContain("Payment submitted");
    expect(fullOutput).toContain("Credits received");
  });

  it("credit card: opens checkout when user selects add new card", async () => {
    const openMock = (await import("open")).default as ReturnType<typeof vi.fn>;
    mockBilling.getStatus.mockResolvedValue({ subscriptionStatus: "active", remainingCredits: 10.0 });
    mockBilling.getPaymentMethods.mockResolvedValue({
      paymentMethods: [
        {
          id: "029641fc-3e5c-11f1-986c-5601121cbf6d",
          stripePaymentMethodId: "pm_1ABC1234",
          brand: "visa",
          last4: "1234",
          createdAt: "2026-04-20T15:00:00Z",
        },
      ],
    });
    mockBilling.purchaseCredits.mockResolvedValue({
      checkoutSessionId: "cs_test_abc123",
      checkoutUrl: "https://checkout.stripe.com/test",
      amountCents: "2500",
    });
    (select as unknown as ReturnType<typeof vi.fn>).mockResolvedValue("new");

    const cmd = createCommand({ amount: "25", method: "card" });
    const promise = cmd.run();
    await vi.advanceTimersByTimeAsync(200_000);
    await promise;
    const fullOutput = logOutput.join("\n");

    expect(mockBilling.purchaseCredits).toHaveBeenCalledWith(2500, undefined);
    expect(openMock).toHaveBeenCalledWith("https://checkout.stripe.com/test");
    expect(fullOutput).toContain("https://checkout.stripe.com/test");
  });

  it("credit card: opens checkout when no card on file", async () => {
    const openMock = (await import("open")).default as ReturnType<typeof vi.fn>;
    mockBilling.getStatus.mockResolvedValue({ subscriptionStatus: "active", remainingCredits: 10.0 });
    mockBilling.getPaymentMethods.mockResolvedValue({ paymentMethods: [] });
    mockBilling.purchaseCredits.mockResolvedValue({
      checkoutSessionId: "cs_test_abc123",
      checkoutUrl: "https://checkout.stripe.com/test",
      amountCents: "5000",
    });

    const cmd = createCommand({ amount: "50", method: "card" });
    const promise = cmd.run();
    await vi.advanceTimersByTimeAsync(200_000);
    await promise;
    const fullOutput = logOutput.join("\n");

    expect(select).not.toHaveBeenCalled();
    expect(mockBilling.purchaseCredits).toHaveBeenCalledWith(5000, undefined);
    expect(openMock).toHaveBeenCalledWith("https://checkout.stripe.com/test");
    expect(fullOutput).toContain("https://checkout.stripe.com/test");
  });

  it("credit card: rejects amount below $5 minimum", async () => {
    mockBilling.getStatus.mockResolvedValue({ subscriptionStatus: "active", remainingCredits: 10.0 });

    const cmd = createCommand({ amount: "3", method: "card" });
    await expect(cmd.run()).rejects.toThrow("Minimum purchase is $5");
  });

  it("credit card: --method and --amount flags skip prompts", async () => {
    mockBilling.getStatus
      .mockResolvedValueOnce({ subscriptionStatus: "active", remainingCredits: 10.0 })
      .mockResolvedValueOnce({ subscriptionStatus: "active", remainingCredits: 60.0 });
    mockBilling.getPaymentMethods.mockResolvedValue({ paymentMethods: [] });
    mockBilling.purchaseCredits.mockResolvedValue({
      checkoutSessionId: "cs_test_abc123",
      checkoutUrl: "https://checkout.stripe.com/test",
      amountCents: "5000",
    });

    const cmd = createCommand({ amount: "50", method: "card" });
    const promise = cmd.run();
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(5_000);
    }
    await promise;

    expect(select).not.toHaveBeenCalled();
    expect(input).not.toHaveBeenCalled();
  });
});
