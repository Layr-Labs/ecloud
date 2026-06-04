import type { Address, PublicClient } from "viem";
import { formatEther } from "viem";
import type { GasEstimate } from "../contract/caller";

/**
 * Thrown when the wallet's native ETH balance is below the estimated on-chain
 * gas cost for a deploy/upgrade.
 *
 * Compute credits (Stripe / USDC-converted) do NOT pay on-chain gas — gas is
 * paid by the user's EOA at send time via EIP-7702. Without this pre-flight the
 * transaction reverts only after submission, which to an agent is
 * indistinguishable from other failures (RND-596).
 */
export class InsufficientGasError extends Error {
  public readonly address: Address;
  public readonly requiredWei: bigint;
  public readonly availableWei: bigint;
  public readonly requiredEth: string;
  public readonly availableEth: string;

  constructor(args: { address: Address; requiredWei: bigint; availableWei: bigint }) {
    const requiredEth = formatEther(args.requiredWei);
    const availableEth = formatEther(args.availableWei);
    super(
      `Insufficient ETH for gas: wallet ${args.address} has ${availableEth} ETH but ` +
        `this transaction needs ~${requiredEth} ETH.\n` +
        `Compute credits do not pay on-chain gas — fund the wallet with ETH and retry.`,
    );
    this.name = "InsufficientGasError";
    this.address = args.address;
    this.requiredWei = args.requiredWei;
    this.availableWei = args.availableWei;
    this.requiredEth = requiredEth;
    this.availableEth = availableEth;
  }
}

/**
 * Pre-flight gate: throw {@link InsufficientGasError} when the wallet's ETH
 * balance is below the estimated gas cost. The threshold is the gas estimate
 * (`maxCostWei`), not zero — dust below the cost must still fail.
 */
export async function assertSufficientGas(args: {
  publicClient: PublicClient;
  address: Address;
  gasEstimate: GasEstimate;
}): Promise<void> {
  const availableWei = await args.publicClient.getBalance({ address: args.address });
  if (availableWei < args.gasEstimate.maxCostWei) {
    throw new InsufficientGasError({
      address: args.address,
      requiredWei: args.gasEstimate.maxCostWei,
      availableWei,
    });
  }
}
