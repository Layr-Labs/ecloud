/**
 * Preflight checks
 */

import { Address, createPublicClient, http, PrivateKeyAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { getEnvironmentConfig } from "../config/environment";
import { addHexPrefix, stripHexPrefix } from "./helpers";

import { Logger, EnvironmentConfig } from "../types";

export interface PreflightContext {
  privateKey: string;
  rpcUrl: string;
  environmentConfig: EnvironmentConfig;
  account: PrivateKeyAccount;
  selfAddress: Address;
}

/**
 * Do preflight checks - performs early validation of authentication and network connectivity
 */
export async function doPreflightChecks(
  options: Partial<{
    privateKey?: string;
    rpcUrl?: string;
    environment?: string;
  }>,
  logger: Logger,
): Promise<PreflightContext> {
  // 1. Get and validate private key first (fail fast)
  logger.debug("Checking authentication...");
  const privateKey = await getPrivateKeyOrFail(options.privateKey);

  // 2. Get environment configuration
  logger.debug("Determining environment...");
  const environmentConfig = getEnvironmentConfig(options.environment || "sepolia");

  // 3. Get RPC URL (from option, env var, or environment default)
  let rpcUrl = options.rpcUrl;
  if (!rpcUrl) {
    rpcUrl = process.env.RPC_URL ?? environmentConfig.defaultRPCURL;
  }
  if (!rpcUrl) {
    throw new Error(
      `RPC URL is required. Provide via options.rpcUrl, RPC_URL env var, or ensure environment has default RPC URL`,
    );
  }

  // 4. Test network connectivity
  logger.debug("Testing network connectivity...");
  const publicClient = createPublicClient({
    transport: http(rpcUrl),
  });

  try {
    // 5. Get chain ID
    const chainID = await publicClient.getChainId();
    if (BigInt(chainID) !== environmentConfig.chainID) {
      throw new Error(`Chain ID mismatch: expected ${environmentConfig.chainID}, got ${chainID}`);
    }
  } catch (err: any) {
    throw new Error(`Cannot connect to ${environmentConfig.name} RPC at ${rpcUrl}: ${err.message}`);
  }

  // 6. Create account from private key
  const privateKeyHex = addHexPrefix(privateKey);
  const account = privateKeyToAccount(privateKeyHex);
  const selfAddress = account.address;

  return {
    privateKey: privateKeyHex,
    rpcUrl,
    environmentConfig,
    account,
    selfAddress,
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
