/**
 * Main SDK Client entry point
 */

import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, mainnet, type Chain } from "viem/chains";
import { createAppModule, type AppModule } from "./modules/app";
import type { WalletClient, Transport, Account } from "viem";
import { getEnvironmentConfig, isEnvironmentAvailable, getAvailableEnvironments } from "./common/config/environment";

// Export all types
export * from "./common/types";

// Export all prompts
export * from "./common/utils/prompts";

// Special case on createApp - we don't need the client to run it
export { createApp, CreateAppOpts } from "./modules/app/create";
export { logs, LogsOptions } from "./modules/app/logs";

// Export utility functions for CLI use
export { getOrPromptAppID } from "./common/utils/prompts";
export { getEnvironmentConfig, getAvailableEnvironments, isEnvironmentAvailable } from "./common/config/environment";

export type Environment = "sepolia" | "sepolia-dev" | "mainnet-alpha";

const CHAINS: Record<string, Chain> = { sepolia, "sepolia-dev": sepolia, "mainnet-alpha": mainnet };

export interface CreateClientConfig {
  verbose: boolean;
  privateKey: `0x${string}`;
  environment: Environment | string;
  rpcUrl?: string;
}

export interface CoreContext {
  verbose: boolean;
  chain: Chain;
  account: ReturnType<typeof privateKeyToAccount>;
  wallet: ReturnType<typeof createWalletClient>;
  publicClient: ReturnType<typeof createPublicClient>;
  privateKey: `0x${string}`;
  rpcUrl: string;
  environment: string;
}

export interface ecloudClient {
  app: AppModule;
  // add other namespaces later
}

export function createECloudClient(cfg: CreateClientConfig): ecloudClient {
  // prefix private key with 0x if it doesn't have it
  if (!cfg.privateKey.startsWith("0x")) {
    cfg.privateKey = `0x${cfg.privateKey}`;
  }

  const environment = cfg.environment || "sepolia";
  
  // Validate environment is available in current build
  if (!isEnvironmentAvailable(environment)) {
    throw new Error(
      `Environment "${environment}" is not available in this build type. ` +
      `Available environments: ${getAvailableEnvironments().join(", ")}`
    );
  }

  // convert private key to account
  const account = privateKeyToAccount(cfg.privateKey);

  // get chain from environment
  const chain = CHAINS[environment];

  // get environment config
  const environmentConfig = getEnvironmentConfig(environment);

  // get rpc url from environment config or use provided rpc url
  let rpc = cfg.rpcUrl;
  if (!rpc) {
    rpc = process.env.RPC_URL ?? environmentConfig.defaultRPCURL;
  }
  if (!rpc) {
    throw new Error(
      `RPC URL is required. Provide via options.rpcUrl, RPC_URL env var, or ensure environment has default RPC URL`,
    );
  }

  // create wallet client
  const wallet = createWalletClient({
    account,
    chain,
    transport: http(rpc),
  }) as WalletClient<Transport, typeof chain, Account>;

  // create public client
  const publicClient = createPublicClient({ chain, transport: http(rpc) });

  // create core context
  const ctx: CoreContext = {
    chain,
    account,
    wallet,
    publicClient,
    verbose: cfg.verbose,
    privateKey: cfg.privateKey,
    rpcUrl: rpc,
    environment: environment,
  };

  // return ecloud client modules
  return {
    app: createAppModule(ctx),
  };
}
