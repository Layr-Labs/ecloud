/**
 * General utility helpers
 */

import { extractChain, createPublicClient, createWalletClient, http } from "viem";
import type { Chain, Hex, PublicClient, WalletClient } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
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
 * Create viem clients from a private key
 *
 * This is a convenience helper for CLI and server applications that have direct
 * access to a private key. For browser applications using external wallets (MetaMask, etc.),
 * create the WalletClient directly using viem's createWalletClient with a custom transport.
 *
 * @example
 * // CLI usage with private key
 * const { walletClient, publicClient } = createClients({
 *   privateKey: '0x...',
 *   rpcUrl: 'https://sepolia.infura.io/v3/...',
 *   chainId: 11155111n
 * });
 *
 * @example
 * // Browser usage with external wallet (create clients directly)
 * const walletClient = createWalletClient({
 *   chain: sepolia,
 *   transport: custom(window.ethereum!)
 * });
 * const publicClient = createPublicClient({
 *   chain: sepolia,
 *   transport: custom(window.ethereum!)
 * });
 */
export function createClients(options: {
  privateKey: string | Hex;
  rpcUrl: string;
  chainId: bigint;
}): {
  walletClient: WalletClient;
  publicClient: PublicClient;
} {
  const { privateKey, rpcUrl, chainId } = options;

  const privateKeyHex = addHexPrefix(privateKey);
  const account = privateKeyToAccount(privateKeyHex);
  const chain = getChainFromID(chainId);

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

  return { walletClient, publicClient };
}

/**
 * Ensure hex string has 0x prefix
 */
export function addHexPrefix(value: string): Hex {
  return (value.startsWith("0x") ? value : `0x${value}`) as Hex;
}

/**
 * Remove 0x prefix from hex string if present
 */
export function stripHexPrefix(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}
