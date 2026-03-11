import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../client", () => ({
  createBillingClient: vi.fn(),
}));

vi.mock("../../../utils/viemClients", () => ({
  createViemClients: vi.fn(),
}));

vi.mock("../../../telemetry", () => ({
  withTelemetry: vi.fn((_cmd: unknown, fn: () => Promise<void>) => fn()),
}));

vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
}));

vi.mock("@layr-labs/ecloud-sdk", async () => {
  const actual = await vi.importActual("@layr-labs/ecloud-sdk");
  return {
    ...actual,
    getEnvironmentConfig: vi.fn().mockReturnValue({
      name: "sepolia",
      build: "dev",
      chainID: BigInt(11155111),
      appControllerAddress: "0xa86DC1C47cb2518327fB4f9A1627F51966c83B92",
      permissionControllerAddress: "0x44632dfBdCb6D3E21EF613B0ca8A6A0c618F5a37",
      erc7702DelegatorAddress: "0x63c0c19a282a1b52b07dd5a65b58948a07dae32b",
      kmsServerURL: "http://10.128.0.57:8080",
      userApiServerURL: "https://userapi-compute-sepolia-dev.eigencloud.xyz",
      defaultRPCURL: "https://ethereum-sepolia-rpc.publicnode.com",
      usdcCreditsAddress: "0xbdA3897c3A428763B59015C64AB766c288C97376",
    }),
  };
});

import BillingTopUp from "../top-up";
import { createBillingClient } from "../../../client";
import { createViemClients } from "../../../utils/viemClients";
import { input } from "@inquirer/prompts";

const WALLET_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const USDC_ADDRESS = "0xUSDCAddress0000000000000000000000000000";
const USDC_CREDITS_ADDRESS = "0xbdA3897c3A428763B59015C64AB766c288C97376";
const TX_HASH = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

describe("ecloud billing top-up", () => {
  let logOutput: string[];
  let mockBilling: {
    address: string;
    getStatus: ReturnType<typeof vi.fn>;
  };
  let mockPublicClient: {
    readContract: ReturnType<typeof vi.fn>;
    waitForTransactionReceipt: ReturnType<typeof vi.fn>;
  };
  let mockWalletClient: {
    writeContract: ReturnType<typeof vi.fn>;
    chain: { id: number };
    account: { address: string };
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    logOutput = [];
    mockBilling = {
      address: WALLET_ADDRESS,
      getStatus: vi.fn(),
    };
    (createBillingClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockBilling);

    mockPublicClient = {
      readContract: vi.fn(),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        transactionHash: TX_HASH,
      }),
    };
    mockWalletClient = {
      writeContract: vi.fn().mockResolvedValue(TX_HASH),
      chain: { id: 11155111 },
      account: { address: WALLET_ADDRESS },
    };
    (createViemClients as ReturnType<typeof vi.fn>).mockReturnValue({
      publicClient: mockPublicClient,
      walletClient: mockWalletClient,
      address: WALLET_ADDRESS,
      chain: { id: 11155111 },
    });

    (input as ReturnType<typeof vi.fn>).mockResolvedValue("50");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setupContractReads(overrides: {
    usdcAddress?: string;
    minimumPurchase?: bigint;
    balanceOf?: bigint;
    allowance?: bigint;
  } = {}) {
    const {
      usdcAddress = USDC_ADDRESS,
      minimumPurchase = BigInt(1_000_000), // 1 USDC
      balanceOf = BigInt(100_000_000), // 100 USDC
      allowance = BigInt(0),
    } = overrides;

    mockPublicClient.readContract.mockImplementation(({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case "usdc":
          return Promise.resolve(usdcAddress);
        case "minimumPurchase":
          return Promise.resolve(minimumPurchase);
        case "balanceOf":
          return Promise.resolve(balanceOf);
        case "allowance":
          return Promise.resolve(allowance);
        default:
          return Promise.reject(new Error(`Unexpected readContract: ${functionName}`));
      }
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

  it("happy path: sufficient balance, approval needed, purchase succeeds", async () => {
    setupContractReads();
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
    // Shows approve step
    expect(fullOutput).toContain("Approving USDC spend");
    expect(fullOutput).toContain("Approved");
    // Shows purchase step
    expect(fullOutput).toContain("Submitting credit purchase");
    expect(fullOutput).toContain("Transaction confirmed");
    // Shows final balance after polling
    expect(fullOutput).toContain("Credits received");
    expect(fullOutput).toContain("$60.00");

    // Verify approve was called
    expect(mockWalletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "approve",
        args: [USDC_CREDITS_ADDRESS, BigInt(50_000_000)],
      }),
    );

    // Verify purchaseCreditsFor was called
    expect(mockWalletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "purchaseCreditsFor",
        args: [BigInt(50_000_000), WALLET_ADDRESS],
      }),
    );
  });

  it("zero USDC balance: exits with fund wallet message", async () => {
    setupContractReads({ balanceOf: BigInt(0) });
    mockBilling.getStatus.mockResolvedValue({ subscriptionStatus: "inactive" });

    const cmd = createCommand({ amount: "50" });
    await cmd.run();
    const fullOutput = logOutput.join("\n");

    expect(fullOutput).toContain("No USDC in wallet");
    expect(fullOutput).toContain("Send USDC on Sepolia to");
    expect(fullOutput).toContain(WALLET_ADDRESS);

    // Should not have called writeContract
    expect(mockWalletClient.writeContract).not.toHaveBeenCalled();
  });

  it("below minimum purchase: shows error", async () => {
    setupContractReads({ minimumPurchase: BigInt(10_000_000) }); // 10 USDC minimum
    mockBilling.getStatus.mockResolvedValue({ subscriptionStatus: "inactive" });

    const cmd = createCommand({ amount: "5" });
    await expect(cmd.run()).rejects.toThrow("Minimum purchase is 10 USDC");
  });

  it("--account flag: passes different address to purchaseCreditsFor", async () => {
    const targetAccount = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    setupContractReads();
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

    // Verify purchaseCreditsFor was called with the target account
    expect(mockWalletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "purchaseCreditsFor",
        args: [BigInt(50_000_000), targetAccount],
      }),
    );
  });

  it("allowance already sufficient: skips approve step", async () => {
    setupContractReads({ allowance: BigInt(100_000_000) }); // 100 USDC already approved
    mockBilling.getStatus
      .mockResolvedValueOnce({ subscriptionStatus: "active", remainingCredits: 10.0 })
      .mockResolvedValueOnce({ subscriptionStatus: "active", remainingCredits: 60.0 });

    const cmd = createCommand({ amount: "50" });
    const promise = cmd.run();
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(5_000);
    }
    await promise;
    const fullOutput = logOutput.join("\n");

    // Should NOT show approve step
    expect(fullOutput).not.toContain("Approving USDC spend");

    // writeContract should only be called once (for purchaseCreditsFor, not approve)
    expect(mockWalletClient.writeContract).toHaveBeenCalledTimes(1);
    expect(mockWalletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "purchaseCreditsFor",
      }),
    );
  });

  it("billing API poll timeout: shows timeout message", async () => {
    setupContractReads();
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
    setupContractReads();
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
    setupContractReads();
    mockBilling.getStatus.mockRejectedValue(new Error("API unavailable"));

    const cmd = createCommand({ amount: "50" });
    const promise = cmd.run();
    // Advance past poll timeout since getStatus always errors
    await vi.advanceTimersByTimeAsync(200_000);
    await promise;
    const fullOutput = logOutput.join("\n");

    // Should still proceed with on-chain purchase
    expect(fullOutput).toContain("Submitting credit purchase");
    expect(fullOutput).toContain("Transaction confirmed");
    // Will timeout on polling since status always errors
    expect(fullOutput).toContain("Credits haven't appeared yet");
  });
});
