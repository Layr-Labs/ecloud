/**
 * Main SDK Client entry point
 */

import { createAppModule, type AppModule } from "./modules/app";
import { createBillingModule, type BillingModule } from "./modules/billing";
import { getEnvironmentConfig } from "./common/config/environment";
import { addHexPrefix } from "./common/utils";

// Export all types
export * from "./common/types";

// Export all prompts
export * from "./common/utils/prompts";

// Special case on createApp - we don't need the client to run it
export { createApp, CreateAppOpts } from "./modules/app/create";
export { logs, LogsOptions } from "./modules/app/logs";

// Export modules for standalone use
export { createAppModule, type AppModuleConfig } from "./modules/app";
export { createBillingModule, type BillingModuleConfig } from "./modules/billing";

// Export utility functions for CLI use
export { getOrPromptAppID } from "./common/utils/prompts";
export { getEnvironmentConfig } from "./common/config/environment";
export { isSubscriptionActive } from "./common/utils/billing";

export type Environment = "sepolia" | "sepolia-dev" | "mainnet-alpha";

export interface ClientConfig {
  verbose: boolean;
  privateKey: `0x${string}`;
  environment: Environment | string;
  rpcUrl?: string;
}

export interface ECloudClient {
  app: AppModule;
  billing: BillingModule;
}

export function createECloudClient(cfg: ClientConfig): ECloudClient {
  cfg.privateKey = addHexPrefix(cfg.privateKey);

  // get environment config
  const environmentConfig = getEnvironmentConfig(cfg.environment || "sepolia");

  // get rpc url from environment config or use provided rpc url
  let rpcUrl = cfg.rpcUrl;
  if (!rpcUrl) {
    rpcUrl = process.env.RPC_URL ?? environmentConfig.defaultRPCURL;
  }
  if (!rpcUrl) {
    throw new Error(
      `RPC URL is required. Provide via options.rpcUrl, RPC_URL env var, or ensure environment has default RPC URL`,
    );
  }

  // return ecloud client modules
  return {
    app: createAppModule({
      rpcUrl,
      verbose: cfg.verbose,
      privateKey: cfg.privateKey,
      environment: cfg.environment,
    }),
    billing: createBillingModule({
      verbose: cfg.verbose,
      privateKey: cfg.privateKey,
    }),
  };
}
