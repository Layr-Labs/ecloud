/**
 * Main upgrade function
 *
 * This is the main entry point for upgrading existing applications on ecloud TEE.
 * It orchestrates all the steps: build, push, encrypt, and upgrade on-chain.
 *
 * NOTE: This SDK function is non-interactive. All required parameters must be
 * provided explicitly. Use the CLI for interactive parameter collection.
 */

import { Address } from "viem";
import { Logger, EnvironmentConfig } from "../../../common/types";
import { getEnvironmentConfig } from "../../../common/config/environment";
import { ensureDockerIsRunning } from "../../../common/docker/build";
import { prepareRelease } from "../../../common/release/prepare";
import {
  upgradeApp,
  prepareUpgradeBatch,
  executeUpgradeBatch,
  type PreparedUpgradeBatch,
  type GasEstimate,
} from "../../../common/contract/caller";
import { estimateBatchGas } from "../../../common/contract/eip7702";
import { watchUntilUpgradeComplete } from "../../../common/contract/watcher";
import {
  validateAppID,
  validateLogVisibility,
  validateResourceUsageMonitoring,
  assertValidImageReference,
  assertValidFilePath,
  LogVisibility,
  ResourceUsageMonitoring,
} from "../../../common/utils/validation";
import { doPreflightChecks } from "../../../common/utils/preflight";
import { checkAppLogPermission } from "../../../common/utils/permissions";
import { defaultLogger } from "../../../common/utils";

/**
 * Required upgrade options for SDK (non-interactive)
 */
export interface SDKUpgradeOptions {
  /** App ID to upgrade - required */
  appId: string | Address;
  /** Private key for signing transactions (hex string with or without 0x prefix) */
  privateKey: string;
  /** RPC URL for blockchain connection - optional, uses environment default if not provided */
  rpcUrl?: string;
  /** Environment name (e.g., 'sepolia', 'mainnet-alpha') - defaults to 'sepolia' */
  environment?: string;
  /** Path to Dockerfile (if building from Dockerfile) - either this or imageRef is required */
  dockerfilePath?: string;
  /** Image reference (registry/path:tag) - either this or dockerfilePath is required */
  imageRef?: string;
  /** Path to .env file - optional */
  envFilePath?: string;
  /** Instance type SKU - required */
  instanceType: string;
  /** Log visibility setting - required */
  logVisibility: LogVisibility;
  /** Resource usage monitoring setting - optional, defaults to 'enable' */
  resourceUsageMonitoring?: ResourceUsageMonitoring;
  /** Optional gas params from estimation */
  gas?: {
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
  };
}

export interface UpgradeResult {
  /** App ID (contract address) */
  appId: string;
  /** Final image reference */
  imageRef: string;
  /** Transaction hash */
  txHash: `0x${string}`;
}

/**
 * Prepared upgrade ready for gas estimation and execution
 */
export interface PreparedUpgrade {
  /** The prepared batch (executions, clients, etc.) */
  batch: PreparedUpgradeBatch;
  /** App ID being upgraded */
  appId: string;
  /** Final image reference */
  imageRef: string;
  /** Preflight context for post-upgrade operations */
  preflightCtx: {
    privateKey: string;
    rpcUrl: string;
    environmentConfig: EnvironmentConfig;
  };
}

/**
 * Result from prepareUpgrade - includes prepared batch and gas estimate
 */
export interface PrepareUpgradeResult {
  /** Prepared upgrade state */
  prepared: PreparedUpgrade;
  /** Gas estimate for the batch transaction */
  gasEstimate: GasEstimate;
}

/**
 * Validate upgrade options and throw descriptive errors for missing/invalid params
 */
function validateUpgradeOptions(options: SDKUpgradeOptions): Address {
  // Private key is required
  if (!options.privateKey) {
    throw new Error("privateKey is required for upgrade");
  }

  // App ID is required
  if (!options.appId) {
    throw new Error("appId is required for upgrade");
  }
  // Validate app ID (must be a valid address - name resolution is done by CLI)
  const resolvedAppID = validateAppID(options.appId);

  // Must have either dockerfilePath or imageRef
  if (!options.dockerfilePath && !options.imageRef) {
    throw new Error("Either dockerfilePath or imageRef is required for upgrade");
  }

  // If imageRef is provided, validate it
  if (options.imageRef) {
    assertValidImageReference(options.imageRef);
  }

  // If dockerfilePath is provided, validate it exists
  if (options.dockerfilePath) {
    assertValidFilePath(options.dockerfilePath);
  }

  // Instance type is required
  if (!options.instanceType) {
    throw new Error("instanceType is required for upgrade");
  }

  // Log visibility is required
  if (!options.logVisibility) {
    throw new Error("logVisibility is required (must be 'public', 'private', or 'off')");
  }
  // Validate log visibility value
  validateLogVisibility(options.logVisibility);

  return resolvedAppID;
}

/**
 * Upgrade an existing application on ECloud TEE
 *
 * This function is non-interactive and requires all parameters to be provided explicitly.
 *
 * Flow:
 * 1. Validate all required parameters
 * 2. Preflight checks (auth, network, etc.)
 * 3. Ensure Docker is running
 * 4. Prepare the release (includes build/push if needed)
 * 5. Check current permission state and determine if change is needed
 * 6. Upgrade the app on-chain
 * 7. Watch until upgrade completes
 *
 * @param options - Required upgrade options
 * @param logger - Optional logger instance
 * @returns UpgradeResult with appID, imageRef, and txHash
 * @throws Error if required parameters are missing or invalid
 */
export async function upgrade(
  options: SDKUpgradeOptions,
  logger: Logger = defaultLogger,
): Promise<UpgradeResult> {
  // 1. Do preflight checks (auth, network, etc.) first
  logger.debug("Performing preflight checks...");
  const preflightCtx = await doPreflightChecks(
    {
      privateKey: options.privateKey,
      rpcUrl: options.rpcUrl,
      environment: options.environment,
    },
    logger,
  );

  // 2. Validate all required parameters upfront
  const appID = validateUpgradeOptions(options);

  // Convert log visibility to internal format
  const { logRedirect, publicLogs } = validateLogVisibility(options.logVisibility);

  // Convert resource usage monitoring to internal format (defaults to "always")
  const resourceUsageAllow = validateResourceUsageMonitoring(options.resourceUsageMonitoring);

  // 3. Check if docker is running, else try to start it
  logger.debug("Checking Docker...");
  await ensureDockerIsRunning();

  // Use provided values (already validated)
  const dockerfilePath = options.dockerfilePath || "";
  const imageRef = options.imageRef || "";
  const envFilePath = options.envFilePath || "";
  const instanceType = options.instanceType;

  // 4. Prepare the release (includes build/push if needed, with automatic retry on permission errors)
  logger.info("Preparing release...");
  const { release, finalImageRef } = await prepareRelease(
    {
      dockerfilePath,
      imageRef,
      envFilePath,
      logRedirect,
      resourceUsageAllow,
      instanceType,
      environmentConfig: preflightCtx.environmentConfig,
      appId: appID as string,
    },
    logger,
  );

  // 5. Check current permission state and determine if change is needed
  logger.debug("Checking current log permission state...");
  const currentlyPublic = await checkAppLogPermission(preflightCtx, appID, logger);
  const needsPermissionChange = currentlyPublic !== publicLogs;

  // 6. Upgrade the app
  logger.info("Upgrading on-chain...");
  const txHash = await upgradeApp(
    {
      privateKey: preflightCtx.privateKey,
      rpcUrl: options.rpcUrl || preflightCtx.rpcUrl,
      environmentConfig: preflightCtx.environmentConfig,
      appId: appID,
      release,
      publicLogs,
      needsPermissionChange,
      imageRef: finalImageRef,
      gas: options.gas,
    },
    logger,
  );

  // 7. Watch until upgrade completes
  logger.info("Waiting for upgrade to complete...");
  await watchUntilUpgradeComplete(
    {
      privateKey: preflightCtx.privateKey,
      rpcUrl: options.rpcUrl || preflightCtx.rpcUrl,
      environmentConfig: preflightCtx.environmentConfig,
      appId: appID,
    },
    logger,
  );

  return {
    appId: appID as string,
    imageRef: finalImageRef,
    txHash,
  };
}

/**
 * Prepare upgrade - does all work up to the transaction
 *
 * This allows CLI to:
 * 1. Call prepareUpgrade to build image, prepare release, get gas estimate
 * 2. Prompt user to confirm the cost
 * 3. Call executeUpgrade with confirmed gas params
 */
export async function prepareUpgrade(
  options: Omit<SDKUpgradeOptions, "gas">,
  logger: Logger = defaultLogger,
): Promise<PrepareUpgradeResult> {
  // 1. Do preflight checks (auth, network, etc.) first
  logger.debug("Performing preflight checks...");
  const preflightCtx = await doPreflightChecks(
    {
      privateKey: options.privateKey,
      rpcUrl: options.rpcUrl,
      environment: options.environment,
    },
    logger,
  );

  // 2. Validate all required parameters upfront
  const appID = validateUpgradeOptions(options as SDKUpgradeOptions);

  // Convert log visibility to internal format
  const { logRedirect, publicLogs } = validateLogVisibility(options.logVisibility);

  // Convert resource usage monitoring to internal format (defaults to "always")
  const resourceUsageAllow = validateResourceUsageMonitoring(options.resourceUsageMonitoring);

  // 3. Check if docker is running, else try to start it
  logger.debug("Checking Docker...");
  await ensureDockerIsRunning();

  // Use provided values (already validated)
  const dockerfilePath = options.dockerfilePath || "";
  const imageRef = options.imageRef || "";
  const envFilePath = options.envFilePath || "";
  const instanceType = options.instanceType;

  // 4. Prepare the release (includes build/push if needed)
  logger.info("Preparing release...");
  const { release, finalImageRef } = await prepareRelease(
    {
      dockerfilePath,
      imageRef,
      envFilePath,
      logRedirect,
      resourceUsageAllow,
      instanceType,
      environmentConfig: preflightCtx.environmentConfig,
      appId: appID as string,
    },
    logger,
  );

  // 5. Check current permission state and determine if change is needed
  logger.debug("Checking current log permission state...");
  const currentlyPublic = await checkAppLogPermission(preflightCtx, appID, logger);
  const needsPermissionChange = currentlyPublic !== publicLogs;

  // 6. Prepare the upgrade batch (creates executions without sending)
  logger.debug("Preparing upgrade batch...");
  const batch = await prepareUpgradeBatch({
    privateKey: preflightCtx.privateKey,
    rpcUrl: options.rpcUrl || preflightCtx.rpcUrl,
    environmentConfig: preflightCtx.environmentConfig,
    appId: appID,
    release,
    publicLogs,
    needsPermissionChange,
  });

  // 7. Estimate gas for the batch
  logger.debug("Estimating gas...");
  const gasEstimate = await estimateBatchGas({
    publicClient: batch.publicClient,
    environmentConfig: batch.environmentConfig,
    executions: batch.executions,
  });

  return {
    prepared: {
      batch,
      appId: appID as string,
      imageRef: finalImageRef,
      preflightCtx: {
        privateKey: preflightCtx.privateKey,
        rpcUrl: preflightCtx.rpcUrl,
        environmentConfig: preflightCtx.environmentConfig,
      },
    },
    gasEstimate,
  };
}

/**
 * Execute a prepared upgrade
 *
 * Call this after prepareUpgrade and user confirmation.
 * Note: This only submits the on-chain transaction. Call watchUpgrade separately
 * to wait for the upgrade to complete.
 */
export async function executeUpgrade(
  prepared: PreparedUpgrade,
  gas: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } | undefined,
  logger: Logger = defaultLogger,
): Promise<UpgradeResult> {
  // Execute the batch transaction
  logger.info("Upgrading on-chain...");
  const txHash = await executeUpgradeBatch(prepared.batch, gas, logger);

  return {
    appId: prepared.appId,
    imageRef: prepared.imageRef,
    txHash,
  };
}

/**
 * Watch an upgrade until it completes
 *
 * Call this after executeUpgrade to wait for the upgrade to finish.
 * Can be called separately to allow for intermediate operations.
 */
export async function watchUpgrade(
  appId: string,
  privateKey: string,
  rpcUrl: string,
  environment: string,
  logger: Logger = defaultLogger,
  clientId?: string,
): Promise<void> {
  const environmentConfig = getEnvironmentConfig(environment);

  logger.info("Waiting for upgrade to complete...");
  await watchUntilUpgradeComplete(
    {
      privateKey,
      rpcUrl,
      environmentConfig,
      appId: appId as Address,
      clientId,
    },
    logger,
  );
}
