/**
 * Main deploy function
 *
 * This is the main entry point for deploying applications to ecloud TEE.
 * It orchestrates all the steps: build, push, encrypt, and deploy on-chain.
 *
 * NOTE: This SDK function is non-interactive. All required parameters must be
 * provided explicitly. Use the CLI for interactive parameter collection.
 */

import type { PublicClient, WalletClient } from "viem";

import { DeployResult, Logger, EnvironmentConfig } from "../../common/types";
import { ensureDockerIsRunning } from "../../common/docker/build";
import { prepareRelease } from "../../common/release/prepare";
import {
  deployApp,
  calculateAppID,
  getMaxActiveAppsPerUser,
  getActiveAppCount,
  prepareDeployBatch,
  executeDeployBatch,
  type PreparedDeployBatch,
} from "../../common/contract/caller";
import { estimateBatchGas } from "../../common/contract/eip7702";
import { type GasEstimate } from "../../common/contract/caller";
import { watchUntilRunning } from "../../common/contract/watcher";
import {
  validateAppName,
  validateLogVisibility,
  validateResourceUsageMonitoring,
  assertValidImageReference,
  assertValidFilePath,
  LogVisibility,
  ResourceUsageMonitoring,
} from "../../common/utils/validation";
import { doPreflightChecks, PreflightContext } from "../../common/utils/preflight";
import { defaultLogger } from "../../common/utils";

/**
 * Required deploy options for SDK (non-interactive)
 */
export interface SDKDeployOptions {
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
  /** App name - required */
  appName: string;
  /** Instance type SKU - required */
  instanceType: string;
  /** Log visibility setting - required */
  logVisibility: LogVisibility;
  /** Resource usage monitoring setting - optional, defaults to 'enable' */
  resourceUsageMonitoring?: ResourceUsageMonitoring;
  /** Optional gas params from estimation */
  gas?: GasEstimate;
}

/**
 * Prepared deployment ready for gas estimation and execution
 */
export interface PreparedDeploy {
  /** The prepared batch (executions, clients, etc.) */
  batch: PreparedDeployBatch;
  /** App name */
  appName: string;
  /** Final image reference */
  imageRef: string;
  /** Preflight context for post-deploy operations */
  preflightCtx: PreflightContext;
}

/**
 * Result from prepareDeploy - includes prepared batch and gas estimate
 */
export interface PrepareDeployResult {
  /** Prepared deployment state */
  prepared: PreparedDeploy;
  /** Gas estimate for the batch transaction */
  gasEstimate: GasEstimate;
}

/**
 * Validate deploy options and throw descriptive errors for missing/invalid params
 */
function validateDeployOptions(options: SDKDeployOptions): void {
  // Private key is required
  if (!options.privateKey) {
    throw new Error("privateKey is required for deployment");
  }

  // Must have either dockerfilePath or imageRef
  if (!options.dockerfilePath && !options.imageRef) {
    throw new Error("Either dockerfilePath or imageRef is required for deployment");
  }

  // If imageRef is provided, validate it
  if (options.imageRef) {
    assertValidImageReference(options.imageRef);
  }

  // If dockerfilePath is provided, validate it exists
  if (options.dockerfilePath) {
    assertValidFilePath(options.dockerfilePath);
  }

  // App name is required
  if (!options.appName) {
    throw new Error("appName is required for deployment");
  }
  validateAppName(options.appName);

  // Instance type is required
  if (!options.instanceType) {
    throw new Error("instanceType is required for deployment");
  }

  // Log visibility is required
  if (!options.logVisibility) {
    throw new Error("logVisibility is required (must be 'public', 'private', or 'off')");
  }
  // Validate log visibility value
  validateLogVisibility(options.logVisibility);
}

/**
 * Deploy an application to ECloud TEE
 *
 * This function is non-interactive and requires all parameters to be provided explicitly.
 *
 * Flow:
 * 1. Validate all required parameters
 * 2. Preflight checks (auth, network, etc.)
 * 3. Check quota availability
 * 4. Ensure Docker is running
 * 5. Generate random salt and calculate app ID
 * 6. Prepare the release (includes build/push if needed)
 * 7. Deploy the app on-chain
 * 8. Watch until app is running
 *
 * @param options - Required deployment options
 * @param logger - Optional logger instance
 * @returns DeployResult with appID, txHash, appName, imageRef, and ipAddress
 * @throws Error if required parameters are missing or invalid
 */
export async function deploy(
  options: SDKDeployOptions,
  logger: Logger = defaultLogger,
): Promise<DeployResult> {
  // 1. Validate all required parameters upfront
  validateDeployOptions(options);

  // Convert log visibility to internal format
  const { logRedirect, publicLogs } = validateLogVisibility(options.logVisibility);

  // Convert resource usage monitoring to internal format (defaults to "always")
  const resourceUsageAllow = validateResourceUsageMonitoring(options.resourceUsageMonitoring);

  // 2. Do preflight checks (auth, network, etc.)
  logger.debug("Performing preflight checks...");
  const preflightCtx = await doPreflightChecks(
    {
      privateKey: options.privateKey,
      rpcUrl: options.rpcUrl,
      environment: options.environment,
    },
    logger,
  );

  // 3. Check quota availability
  logger.debug("Checking quota availability...");
  await checkQuotaAvailable(preflightCtx);

  // 4. Check if docker is running, else try to start it
  logger.debug("Checking Docker...");
  await ensureDockerIsRunning();

  // Use provided values (already validated)
  const dockerfilePath = options.dockerfilePath || "";
  const imageRef = options.imageRef || "";
  const appName = options.appName;
  const envFilePath = options.envFilePath || "";
  const instanceType = options.instanceType;

  // 5. Generate random salt
  const salt = generateRandomSalt();
  logger.debug(`Generated salt: ${Buffer.from(salt).toString("hex")}`);

  // 6. Get app ID (calculate from salt and address)
  logger.debug("Calculating app ID...");
  const appIDToBeDeployed = await calculateAppID({
    publicClient: preflightCtx.publicClient,
    environmentConfig: preflightCtx.environmentConfig,
    ownerAddress: preflightCtx.selfAddress,
    salt,
  });
  logger.info(``);
  logger.info(`App ID: ${appIDToBeDeployed}`);
  logger.info(``);

  // 7. Prepare the release (includes build/push if needed, with automatic retry on permission errors)
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
      appId: appIDToBeDeployed,
    },
    logger,
  );

  // 8. Deploy the app
  logger.info("Deploying on-chain...");
  const deployResult = await deployApp(
    {
      walletClient: preflightCtx.walletClient,
      publicClient: preflightCtx.publicClient,
      environmentConfig: preflightCtx.environmentConfig,
      salt,
      release,
      publicLogs,
      imageRef: finalImageRef,
      gas: options.gas,
    },
    logger,
  );

  // 9. Watch until app is running
  logger.info("Waiting for app to start...");
  const ipAddress = await watchUntilRunning(
    {
      walletClient: preflightCtx.walletClient,
      publicClient: preflightCtx.publicClient,
      environmentConfig: preflightCtx.environmentConfig,
      appId: deployResult.appId,
    },
    logger,
  );

  return {
    appId: deployResult.appId,
    txHash: deployResult.txHash,
    appName,
    imageRef: finalImageRef,
    ipAddress,
  };
}

/**
 * Check quota availability - verifies that the user has deployment quota available
 * by checking their allowlist status on the contract
 */
async function checkQuotaAvailable(preflightCtx: PreflightContext): Promise<void> {
  const { publicClient, environmentConfig, selfAddress: userAddress } = preflightCtx;

  // Check user's quota limit from contract
  let maxQuota: number;
  try {
    maxQuota = await getMaxActiveAppsPerUser(publicClient, environmentConfig, userAddress);
  } catch (err: any) {
    throw new Error(`failed to get quota limit: ${err.message}`);
  }

  // If quota is 0, user needs to subscribe
  if (maxQuota === 0) {
    throw new Error(
      "no app quota available. Run 'npx ecloud billing subscribe' to enable app deployment",
    );
  }

  // Check current active app count from contract
  let activeCount: number;
  try {
    activeCount = await getActiveAppCount(publicClient, environmentConfig, userAddress);
  } catch (err: any) {
    throw new Error(`failed to get active app count: ${err.message}`);
  }

  // Check if quota is reached
  if (activeCount >= maxQuota) {
    throw new Error(
      `app quota reached for ${environmentConfig.name} (${activeCount}/${maxQuota}). Please contact the Eigen team at eigencloud_support@eigenlabs.org for additional capacity`,
    );
  }
}

/**
 * Generate random 32-byte salt
 */
function generateRandomSalt(): Uint8Array {
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  return salt;
}

/**
 * Prepare deployment - does all work up to the transaction
 *
 * This allows CLI to:
 * 1. Call prepareDeploy to build image, prepare release, get gas estimate
 * 2. Prompt user to confirm the cost
 * 3. Call executeDeploy with confirmed gas params
 */
export async function prepareDeploy(
  options: Omit<SDKDeployOptions, "gas">,
  logger: Logger = defaultLogger,
): Promise<PrepareDeployResult> {
  // 1. Validate all required parameters upfront
  validateDeployOptions(options as SDKDeployOptions);

  // Convert log visibility to internal format
  const { logRedirect, publicLogs } = validateLogVisibility(options.logVisibility);

  // Convert resource usage monitoring to internal format (defaults to "always")
  const resourceUsageAllow = validateResourceUsageMonitoring(options.resourceUsageMonitoring);

  // 2. Do preflight checks (auth, network, etc.)
  logger.debug("Performing preflight checks...");
  const preflightCtx = await doPreflightChecks(
    {
      privateKey: options.privateKey,
      rpcUrl: options.rpcUrl,
      environment: options.environment,
    },
    logger,
  );

  // 3. Check quota availability
  logger.debug("Checking quota availability...");
  await checkQuotaAvailable(preflightCtx);

  // 4. Check if docker is running, else try to start it
  logger.debug("Checking Docker...");
  await ensureDockerIsRunning();

  // Use provided values (already validated)
  const dockerfilePath = options.dockerfilePath || "";
  const imageRef = options.imageRef || "";
  const appName = options.appName;
  const envFilePath = options.envFilePath || "";
  const instanceType = options.instanceType;

  // 5. Generate random salt
  const salt = generateRandomSalt();
  logger.debug(`Generated salt: ${Buffer.from(salt).toString("hex")}`);

  // 6. Get app ID (calculate from salt and address)
  logger.debug("Calculating app ID...");
  const appIDToBeDeployed = await calculateAppID({
    publicClient: preflightCtx.publicClient,
    environmentConfig: preflightCtx.environmentConfig,
    ownerAddress: preflightCtx.selfAddress,
    salt,
  });
  logger.info(``);
  logger.info(`App ID: ${appIDToBeDeployed}`);
  logger.info(``);

  // 7. Prepare the release (includes build/push if needed)
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
      appId: appIDToBeDeployed,
    },
    logger,
  );

  // 8. Prepare the deploy batch (creates executions without sending)
  logger.debug("Preparing deploy batch...");
  const batch = await prepareDeployBatch(
    {
      walletClient: preflightCtx.walletClient,
      publicClient: preflightCtx.publicClient,
      environmentConfig: preflightCtx.environmentConfig,
      salt,
      release,
      publicLogs,
      imageRef: finalImageRef,
    },
    logger,
  );

  // 9. Estimate gas for the batch
  logger.debug("Estimating gas...");
  const account = batch.walletClient.account;
  if (!account) {
    throw new Error("WalletClient must have an account attached");
  }
  const gasEstimate = await estimateBatchGas({
    publicClient: batch.publicClient,
    account: account.address,
    executions: batch.executions,
  });

  return {
    prepared: {
      batch,
      appName,
      imageRef: finalImageRef,
      preflightCtx,
    },
    gasEstimate,
  };
}

/**
 * Execute a prepared deployment
 *
 * Call this after prepareDeploy and user confirmation.
 * Note: This only submits the on-chain transaction. Call watchDeployment separately
 * to wait for the app to be running.
 */
export async function executeDeploy(
  prepared: PreparedDeploy,
  gas: GasEstimate | undefined,
  logger: Logger = defaultLogger,
): Promise<DeployResult> {
  // Execute the batch transaction
  logger.info("Deploying on-chain...");
  const { appId, txHash } = await executeDeployBatch(
    {
      appId: prepared.batch.appId,
      salt: prepared.batch.salt,
      executions: prepared.batch.executions,
    },
    {
      walletClient: prepared.batch.walletClient,
      publicClient: prepared.batch.publicClient,
      environmentConfig: prepared.batch.environmentConfig,
    },
    gas,
    logger,
  );

  return {
    appId,
    txHash,
    appName: prepared.appName,
    imageRef: prepared.imageRef,
  };
}

/**
 * Watch a deployment until the app is running
 *
 * Call this after executeDeploy to wait for the app to be provisioned.
 * Can be called separately to allow for intermediate operations (e.g., profile upload).
 */
export async function watchDeployment(
  appId: string,
  walletClient: WalletClient,
  publicClient: PublicClient,
  environmentConfig: EnvironmentConfig,
  logger: Logger = defaultLogger,
): Promise<string | undefined> {
  logger.info("Waiting for app to start...");
  return watchUntilRunning(
    {
      walletClient,
      publicClient,
      environmentConfig,
      appId: appId as `0x${string}`,
    },
    logger,
  );
}

// Re-export for convenience
export { extractAppNameFromImage } from "../../common/utils/validation";
