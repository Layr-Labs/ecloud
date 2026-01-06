/**
 * Preflight checks
 *
 * Performs early validation of authentication and network connectivity.
 *
 * Accepts viem's WalletClient which abstracts over both local accounts
 * (privateKeyToAccount) and external signers (MetaMask, etc.).
 *
 * @example
 * // CLI usage with private key
 * const { walletClient, publicClient } = createClients({ privateKey, rpcUrl, chainId });
 * const ctx = await doPreflightChecks({ walletClient, publicClient, environment }, logger);
 *
 * @example
 * // Browser usage with external wallet
 * const walletClient = createWalletClient({ chain, transport: custom(window.ethereum!) });
 * const publicClient = createPublicClient({ chain, transport: custom(window.ethereum!) });
 * const ctx = await doPreflightChecks({ walletClient, publicClient, environment }, logger);
 */

import {
  Address,
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { getEnvironmentConfig } from "../config/environment";
import { addHexPrefix, stripHexPrefix, getChainFromID } from "./helpers";

import { Logger, EnvironmentConfig } from "../types";

export interface PreflightContext {
  walletClient: WalletClient;
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  selfAddress: Address;
}

/**
 * Options for preflight checks with WalletClient (browser/external signer mode)
 */
export interface PreflightOptionsWithWalletClient {
  walletClient: WalletClient;
  publicClient: PublicClient;
  environment?: string;
}

/**
 * Options for preflight checks with private key (CLI mode)
 */
export interface PreflightOptionsWithPrivateKey {
  privateKey?: string;
  rpcUrl?: string;
  environment?: string;
}

export type PreflightOptions = PreflightOptionsWithWalletClient | PreflightOptionsWithPrivateKey;

function hasWalletClient(
  options: PreflightOptions,
): options is PreflightOptionsWithWalletClient {
  return "walletClient" in options && options.walletClient !== undefined;
}

/**
 * Do preflight checks - performs early validation of authentication and network connectivity.
 *
 * Supports two modes:
 * 1. CLI mode: Pass privateKey and optional rpcUrl - clients are created internally
 * 2. Browser mode: Pass walletClient and publicClient directly
 */
export async function doPreflightChecks(
  options: PreflightOptions,
  logger: Logger,
): Promise<PreflightContext> {
  // Get environment configuration
  logger.debug("Determining environment...");
  const environmentConfig = getEnvironmentConfig(options.environment || "sepolia");

  if (hasWalletClient(options)) {
    // Browser/external signer mode - use provided clients
    const { walletClient, publicClient } = options;

    const account = walletClient.account;
    if (!account) {
      throw new Error("WalletClient must have an account attached");
    }

    // Validate chain ID
    logger.debug("Validating chain ID...");
    const chainID = await publicClient.getChainId();
    if (BigInt(chainID) !== environmentConfig.chainID) {
      throw new Error(`Chain ID mismatch: expected ${environmentConfig.chainID}, got ${chainID}`);
    }

    return {
      walletClient,
      publicClient,
      environmentConfig,
      selfAddress: account.address,
    };
  }

  // CLI mode - create clients from private key
  logger.debug("Checking authentication...");
  const privateKey = await getPrivateKeyOrFail(options.privateKey);

  // Get RPC URL (from option, env var, or environment default)
  let rpcUrl = options.rpcUrl;
  if (!rpcUrl) {
    rpcUrl = process.env.RPC_URL ?? environmentConfig.defaultRPCURL;
  }
  if (!rpcUrl) {
    throw new Error(
      `RPC URL is required. Provide via options.rpcUrl, RPC_URL env var, or ensure environment has default RPC URL`,
    );
  }

  // Test network connectivity
  logger.debug("Testing network connectivity...");
  const chain = getChainFromID(environmentConfig.chainID);
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  try {
    // Get chain ID
    const chainID = await publicClient.getChainId();
    if (BigInt(chainID) !== environmentConfig.chainID) {
      throw new Error(`Chain ID mismatch: expected ${environmentConfig.chainID}, got ${chainID}`);
    }
  } catch (err: any) {
    throw new Error(`Cannot connect to ${environmentConfig.name} RPC at ${rpcUrl}: ${err.message}`);
  }

  // Create account and wallet client from private key
  const privateKeyHex = addHexPrefix(privateKey) as `0x${string}`;
  const account = privateKeyToAccount(privateKeyHex);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  }) as WalletClient;

  return {
    walletClient,
    publicClient: publicClient as PublicClient,
    environmentConfig,
    selfAddress: account.address,
  };
}

/**
 * Get private key from options, environment variable, or keyring
 */
async function getPrivateKeyOrFail(privateKey?: string): Promise<string> {
  // Check option first
  if (privateKey) {
    validatePrivateKey(privateKey);
    return privateKey;
  }

  // Check environment variable
  if (process.env.PRIVATE_KEY) {
    validatePrivateKey(process.env.PRIVATE_KEY);
    return process.env.PRIVATE_KEY;
  }

  // TODO: Check keyring (OS keyring integration)
  // For now, throw error with instructions
  throw new Error(
    `private key required. Please provide it via:
  • Option: privateKey in deploy options
  • Environment: export PRIVATE_KEY=YOUR_KEY
  • Keyring: (not yet implemented)`,
  );
}

/**
 * Validate private key format
 */
function validatePrivateKey(key: string): void {
  const cleaned = stripHexPrefix(key);
  if (!/^[0-9a-fA-F]{64}$/.test(cleaned)) {
    throw new Error("Invalid private key format (must be 64 hex characters)");
  }
}
