/**
 * Preflight checks
 *
 * Performs early validation of authentication and network connectivity.
 * Accepts viem's WalletClient and PublicClient - the caller is responsible
 * for creating these from a private key if needed.
 */

import { Address, type PublicClient, type WalletClient } from "viem";

import { getEnvironmentConfig } from "../config/environment";
import { Logger, EnvironmentConfig } from "../types";

export interface PreflightContext {
  walletClient: WalletClient;
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  selfAddress: Address;
}

export interface PreflightOptions {
  walletClient: WalletClient;
  publicClient: PublicClient;
  environment?: string;
}

/**
 * Do preflight checks - performs early validation of authentication and network connectivity.
 *
 * @param options - WalletClient, PublicClient, and optional environment name
 * @param logger - Logger instance
 * @returns PreflightContext with validated clients and environment config
 */
export async function doPreflightChecks(
  options: PreflightOptions,
  logger: Logger,
): Promise<PreflightContext> {
  const { walletClient, publicClient } = options;

  // Get environment configuration
  logger.debug("Determining environment...");
  const environmentConfig = getEnvironmentConfig(options.environment || "sepolia");

  // Validate that wallet client has an account attached
  const account = walletClient.account;
  if (!account) {
    throw new Error("WalletClient must have an account attached");
  }

  // Validate chain ID
  logger.debug("Validating chain ID...");
  try {
    const chainID = await publicClient.getChainId();
    if (BigInt(chainID) !== environmentConfig.chainID) {
      throw new Error(`Chain ID mismatch: expected ${environmentConfig.chainID}, got ${chainID}`);
    }
  } catch (err: any) {
    throw new Error(
      `Cannot connect to ${environmentConfig.name} RPC at ${publicClient.transport.url}: ${err.message}`,
    );
  }

  return {
    walletClient,
    publicClient,
    environmentConfig,
    selfAddress: account.address,
  };
}
