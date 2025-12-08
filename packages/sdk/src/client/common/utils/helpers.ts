/**
 * General utility helpers
 */

import { extractChain } from "viem";
import type { Chain } from "viem";
import { sepolia } from "viem/chains";
import { SUPPORTED_CHAINS } from "../constants";

/**
 * Get a viem Chain object from a chain ID.
 * Supports mainnet (1) and sepolia (11155111), defaults to the fallback chain for unknown chains.
 */
export function getChainFromID(chainID: bigint, fallback: Chain = sepolia): Chain {
  const id = Number(chainID) as (typeof SUPPORTED_CHAINS)[number]["id"];
  return extractChain({ chains: SUPPORTED_CHAINS, id }) || fallback;
}

/**
 * Ensure hex string has 0x prefix
 */
export function addHexPrefix(value: string): `0x${string}` {
  return (value.startsWith("0x") ? value : `0x${value}`) as `0x${string}`;
}

/**
 * Remove 0x prefix from hex string if present
 */
export function stripHexPrefix(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}
