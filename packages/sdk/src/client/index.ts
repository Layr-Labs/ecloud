/**
 * Main SDK Client entry point
 */

import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, mainnet, type Chain } from "viem/chains";
import { createAppModule, type AppModule } from "./modules/app";
import type { WalletClient, Transport, Account } from "viem";
import { getEnvironmentConfig } from "./common/config/environment";

// Export all types
export * from "./common/types";

// special case on createApp - we don't need the client to run it
export { createApp, CreateAppOpts } from "./modules/app/create/create";

export type Environment = "sepolia" | "mainnet-alpha";

const CHAINS: Record<string, Chain> = { sepolia, "mainnet-alpha": mainnet };

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
  const chain = CHAINS[cfg.environment];
  const account = privateKeyToAccount(cfg.privateKey);

  const environmentConfig = getEnvironmentConfig(cfg.environment || "sepolia");

  let rpc = cfg.rpcUrl;
  if (!rpc) {
    rpc = process.env.RPC_URL ?? environmentConfig.defaultRPCURL;
  }
  if (!rpc) {
    throw new Error(
      `RPC URL is required. Provide via options.rpcUrl, RPC_URL env var, or ensure environment has default RPC URL`,
    );
  }

  const wallet = createWalletClient({
    account,
    chain,
    transport: http(rpc),
  }) as WalletClient<Transport, typeof chain, Account>;

  const publicClient = createPublicClient({ chain, transport: http(rpc) });

  const ctx: CoreContext = {
    chain,
    account,
    wallet,
    publicClient,
    verbose: cfg.verbose,
    privateKey: cfg.privateKey,
    rpcUrl: rpc,
    environment: cfg.environment,
  };

  return {
    app: createAppModule(ctx),
  };
}
