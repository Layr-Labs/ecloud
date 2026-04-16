/**
 * Shared contract ABIs and on-chain read helpers for identity management.
 */

import type { Address, PublicClient } from "viem";
import { formatDelay } from "./format";

export const SAFE_ABI = [
  { name: "getThreshold", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "getOwners", type: "function", inputs: [], outputs: [{ type: "address[]" }], stateMutability: "view" },
] as const;

export const TIMELOCK_ABI = [
  { name: "getMinDelay", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "hasRole", type: "function", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [{ type: "bool" }], stateMutability: "view" },
] as const;

/** Fetch threshold and owners for a Gnosis Safe. Returns undefined fields on failure. */
export async function fetchSafeInfo(
  publicClient: PublicClient,
  safe: Address,
): Promise<{ threshold: number | undefined; owners: string[] | undefined }> {
  try {
    const [t, o] = await Promise.all([
      publicClient.readContract({ address: safe, abi: SAFE_ABI, functionName: "getThreshold" }) as Promise<bigint>,
      publicClient.readContract({ address: safe, abi: SAFE_ABI, functionName: "getOwners" }) as Promise<Address[]>,
    ]);
    return { threshold: Number(t), owners: o.map(String) };
  } catch {
    return { threshold: undefined, owners: undefined };
  }
}

/** Fetch getMinDelay() from a Timelock and return as human-readable string (e.g. "24h"). */
export async function fetchTimelockDelay(
  publicClient: PublicClient,
  timelock: Address,
): Promise<string> {
  try {
    const minDelay = await publicClient.readContract({ address: timelock, abi: TIMELOCK_ABI, functionName: "getMinDelay" }) as bigint;
    return formatDelay(minDelay);
  } catch {
    return "unknown";
  }
}
