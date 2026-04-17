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

// keccak256("PROPOSER_ROLE")
const PROPOSER_ROLE = "0xb09aa5aeb3702cfd50b6b62bc4532604938f21248a27a1d5ca736082b6819cc1" as const;

/** Check if a candidate address has PROPOSER_ROLE on a TimelockController. */
export async function isTimelockProposer(
  publicClient: PublicClient,
  timelock: Address,
  candidate: Address,
): Promise<boolean> {
  try {
    return await publicClient.readContract({
      address: timelock, abi: TIMELOCK_ABI, functionName: "hasRole", args: [PROPOSER_ROLE, candidate],
    }) as boolean;
  } catch {
    return false;
  }
}

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
