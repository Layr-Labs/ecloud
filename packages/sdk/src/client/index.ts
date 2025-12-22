/**
 * Main SDK Client entry point
 */

import { createComputeModule, type ComputeModule } from "./modules/compute";
import {
  getEnvironmentConfig,
  isEnvironmentAvailable,
  getAvailableEnvironments,
} from "./common/config/environment";
import { createBillingModule, type BillingModule } from "./modules/billing";
import { addHexPrefix } from "./common/utils";
import { Hex } from "viem";

// Export all types
export * from "./common/types";

// Export validation utilities (non-interactive)
export * from "./common/utils/validation";

// Special case on createApp - we don't need the client to run it
export {
  createApp,
  CreateAppOpts,
  SDKCreateAppOpts,
  PRIMARY_LANGUAGES,
  getAvailableTemplates,
} from "./modules/compute/app/create";
export { logs, LogsOptions, SDKLogsOptions } from "./modules/compute/app/logs";
export {
  SDKDeployOptions,
  prepareDeploy,
  executeDeploy,
  watchDeployment,
  type PreparedDeploy,
  type PrepareDeployResult,
} from "./modules/compute/app/deploy";
export {
  SDKUpgradeOptions,
  prepareUpgrade,
  executeUpgrade,
  watchUpgrade,
  type PreparedUpgrade,
  type PrepareUpgradeResult,
} from "./modules/compute/app/upgrade";

// Export compute module for standalone use
export {
  createComputeModule,
  type ComputeModule,
  type ComputeModuleConfig,
  encodeStartAppData,
  encodeStopAppData,
  encodeTerminateAppData,
} from "./modules/compute";
export {
  createBillingModule,
  type BillingModule,
  type BillingModuleConfig,
} from "./modules/billing";

// Export environment config utilities
export {
  getEnvironmentConfig,
  getAvailableEnvironments,
  isEnvironmentAvailable,
  getBuildType,
  isMainnet,
} from "./common/config/environment";
export { isSubscriptionActive } from "./common/utils/billing";

// Export auth utilities
export * from "./common/auth";

// Export telemetry
export * from "./common/telemetry";

// Export template catalog utilities for CLI
export {
  fetchTemplateCatalog,
  getTemplate,
  getCategoryDescriptions,
} from "./common/templates/catalog";

// Export contract utilities
export {
  getAllAppsByDeveloper,
  getAppLatestReleaseBlockNumbers,
  getBlockTimestamps,
  estimateTransactionGas,
  formatETH,
  type GasEstimate,
  type EstimateGasOptions,
} from "./common/contract/caller";

// Export batch gas estimation and delegation check
export {
  estimateBatchGas,
  checkERC7702Delegation,
  type EstimateBatchGasOptions,
} from "./common/contract/eip7702";

// Export instance type utilities
export { getCurrentInstanceType } from "./common/utils/instance";

// Export user API client
export {
  UserApiClient,
  type AppInfo,
  type AppProfileInfo,
  type AppMetrics,
} from "./common/utils/userapi";

export type Environment = "sepolia" | "sepolia-dev" | "mainnet-alpha";

export interface ClientConfig {
  verbose: boolean;
  privateKey: Hex;
  environment: Environment | string;
  rpcUrl?: string;
}

export interface ECloudClient {
  compute: ComputeModule;
  billing: BillingModule;
}

export function createECloudClient(cfg: ClientConfig): ECloudClient {
  cfg.privateKey = addHexPrefix(cfg.privateKey);

  // Validate environment is available in current build
  const environment = cfg.environment || "sepolia";
  if (!isEnvironmentAvailable(environment)) {
    throw new Error(
      `Environment "${environment}" is not available in this build type. ` +
        `Available environments: ${getAvailableEnvironments().join(", ")}`,
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
    compute: createComputeModule({
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
