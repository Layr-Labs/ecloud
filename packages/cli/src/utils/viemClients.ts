/**
 * Viem client utilities for CLI
 *
 * Creates PublicClient and WalletClient instances from common flags.
 * These are needed for SDK functions that require viem clients directly.
 */

import {
  createPublicClient,
  http,
  type PublicClient,
  type WalletClient,
  type Address,
  type Hex,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  getEnvironmentConfig,
  addHexPrefix,
  createViemClients as sdkCreateViemClients,
  getChainFromID,
} from "@layr-labs/ecloud-sdk";

export interface ClientOptions {
  privateKey: Hex | string;
  rpcUrl?: string;
  environment: string;
}

export interface ViemClients {
  publicClient: PublicClient;
  walletClient: WalletClient;
  chain: Chain;
  address: Address;
}

/**
 * Create viem PublicClient and WalletClient from CLI options
 */
export function createViemClients(options: ClientOptions): ViemClients {
  const privateKey = addHexPrefix(options.privateKey) as Hex;
  const environmentConfig = getEnvironmentConfig(options.environment);
  const rpcUrl = options.rpcUrl || environmentConfig.defaultRPCURL;
  const chain = getChainFromID(environmentConfig.chainID);

  const { publicClient, walletClient } = sdkCreateViemClients({
    privateKey,
    rpcUrl,
    chainId: environmentConfig.chainID,
  });

  const account = privateKeyToAccount(privateKey);

  return {
    publicClient,
    walletClient,
    chain,
    address: account.address,
  };
}

/**
 * Create only PublicClient (for read-only operations)
 */
export function createPublicClientOnly(options: {
  rpcUrl?: string;
  environment: string;
}): PublicClient {
  const environmentConfig = getEnvironmentConfig(options.environment);
  const rpcUrl = options.rpcUrl || environmentConfig.defaultRPCURL;
  const chain = getChainFromID(environmentConfig.chainID);

  return createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
}
