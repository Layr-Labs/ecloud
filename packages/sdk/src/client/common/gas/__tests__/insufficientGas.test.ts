import { describe, expect, it } from "vitest";
import type { Address, PublicClient } from "viem";
import { assertSufficientGas, InsufficientGasError } from "../insufficientGas";
import type { GasEstimate } from "../../contract/caller";

const ADDR = "0x540d6701c396f77c3601FC34585107497ED71495" as Address;

function gasEstimate(maxCostWei: bigint): GasEstimate {
  return {
    gasLimit: BigInt(21000),
    maxFeePerGas: BigInt(1),
    maxPriorityFeePerGas: BigInt(1),
    maxCostWei,
    maxCostEth: "0",
  };
}

function clientWithBalance(balanceWei: bigint): PublicClient {
  return { getBalance: async () => balanceWei } as unknown as PublicClient;
}

describe("assertSufficientGas (RND-596)", () => {
  it("passes when balance exceeds the estimate", async () => {
    await expect(
      assertSufficientGas({
        publicClient: clientWithBalance(BigInt(10)),
        address: ADDR,
        gasEstimate: gasEstimate(BigInt(5)),
      }),
    ).resolves.toBeUndefined();
  });

  it("passes when balance exactly equals the estimate", async () => {
    await expect(
      assertSufficientGas({
        publicClient: clientWithBalance(BigInt(5)),
        address: ADDR,
        gasEstimate: gasEstimate(BigInt(5)),
      }),
    ).resolves.toBeUndefined();
  });

  it("throws InsufficientGasError on dust below the estimate (not just zero)", async () => {
    await expect(
      assertSufficientGas({
        publicClient: clientWithBalance(BigInt(4)),
        address: ADDR,
        gasEstimate: gasEstimate(BigInt(5)),
      }),
    ).rejects.toBeInstanceOf(InsufficientGasError);
  });

  it("error carries required/available and a credits-don't-pay-gas message", async () => {
    try {
      await assertSufficientGas({
        publicClient: clientWithBalance(BigInt(0)),
        address: ADDR,
        gasEstimate: gasEstimate(BigInt(7)),
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InsufficientGasError);
      const e = err as InsufficientGasError;
      expect(e.requiredWei).toBe(BigInt(7));
      expect(e.availableWei).toBe(BigInt(0));
      expect(e.address).toBe(ADDR);
      expect(e.message).toMatch(/credits do not pay on-chain gas/i);
    }
  });
});
