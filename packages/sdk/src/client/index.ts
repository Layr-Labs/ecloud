/**
 * Main SDK Client entry point
 */

import { createAppModule, type AppModule } from "./modules/app";
import { getEnvironmentConfig, isEnvironmentAvailable, getAvailableEnvironments } from "./common/config/environment";
import { createBillingModule, type BillingModule } from "./modules/billing";
import { addHexPrefix } from "./common/utils";

// Export all types
export * from "./common/types";

// Export validation utilities (non-interactive)
export * from "./common/utils/validation";

// Special case on createApp - we don't need the client to run it
export { createApp, CreateAppOpts, SDKCreateAppOpts, PRIMARY_LANGUAGES, getAvailableTemplates } from "./modules/app/create";
export { logs, LogsOptions, SDKLogsOptions } from "./modules/app/logs";
export { SDKDeployOptions } from "./modules/app/deploy";
export { SDKUpgradeOptions } from "./modules/app/upgrade";

// Export modules for standalone use
export { 
  createAppModule, 
  type AppModuleConfig,
  encodeStartAppData,
  encodeStopAppData,
  encodeTerminateAppData,
} from "./modules/app";
export { createBillingModule, type BillingModuleConfig } from "./modules/billing";

// Export environment config utilities
export { getEnvironmentConfig, getAvailableEnvironments, isEnvironmentAvailable, getBuildType, isMainnet } from "./common/config/environment";
export { isSubscriptionActive } from "./common/utils/billing";

// Export global config functions
export {
  loadGlobalConfig,
  saveGlobalConfig,
  getDefaultEnvironment,
  setDefaultEnvironment,
  isFirstRun,
  markFirstRunComplete,
  getGlobalTelemetryPreference,
  setGlobalTelemetryPreference,
  type GlobalConfig,
} from "./common/config/globalConfig";

// Export auth utilities
export * from "./common/auth";

// Export template catalog utilities for CLI
export {
  fetchTemplateCatalog,
  getTemplate,
  getCategoryDescriptions,
} from "./common/templates/catalog";

// Export registry utilities
export { listApps, getAppName, setAppName } from "./common/registry/appNames";

// Export contract utilities
export { 
  getAllAppsByDeveloper,
  estimateTransactionGas,
  formatETH,
  type GasEstimate,
  type EstimateGasOptions,
} from "./common/contract/caller";

// Export batch gas estimation
export { estimateBatchGas, type EstimateBatchGasOptions } from "./common/contract/eip7702";

// Export instance type utilities
export { getCurrentInstanceType } from "./common/utils/instance";

// Export user API client
export { UserApiClient } from "./common/utils/userapi";

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


  // Validate environment is available in current build
  const environment = cfg.environment || "sepolia";
  if (!isEnvironmentAvailable(environment)) {
    throw new Error(
      `Environment "${environment}" is not available in this build type. ` +
      `Available environments: ${getAvailableEnvironments().join(", ")}`
    );
  }

  // Get environment config
  const environmentConfig = getEnvironmentConfig(environment);

  // Get rpc url from environment config or use provided rpc url
  let rpcUrl = cfg.rpcUrl;
  if (!rpcUrl) {
    rpcUrl = process.env.RPC_URL ?? environmentConfig.defaultRPCURL;
  }
  if (!rpcUrl) {
    throw new Error(
      `RPC URL is required. Provide via options.rpcUrl, RPC_URL env var, or ensure environment has default RPC URL`,
    );
  }

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
