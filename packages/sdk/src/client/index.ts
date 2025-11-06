import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, mainnet, type Chain } from "viem/chains";
import { createAppModule, type AppModule } from "./modules/app";
import type { WalletClient, Transport, Account } from "viem";

export type Environment = "sepolia" | "mainnet-alpha";

const CHAINS: Record<string, Chain> = { sepolia, "mainnet-alpha": mainnet };

export interface CreateClientConfig {
  privateKey: `0x${string}`;
  environment: Environment | string;
  rpcUrl?: string;
  apiBaseUrl?: string;
}

export interface CoreContext {
  chain: Chain;
  account: ReturnType<typeof privateKeyToAccount>;
  wallet: ReturnType<typeof createWalletClient>;
  publicClient: ReturnType<typeof createPublicClient>;
  apiBaseUrl?: string;
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
  const rpc = cfg.rpcUrl ?? chain.rpcUrls.default.http[0];
  const account = privateKeyToAccount(cfg.privateKey);

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
    apiBaseUrl: cfg.apiBaseUrl,
    privateKey: cfg.privateKey,
    rpcUrl: rpc,
    environment: cfg.environment,
  };

  return {
    app: createAppModule(ctx),
  };
}
