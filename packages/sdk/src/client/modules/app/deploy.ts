/**
 * Main deploy function
 *
 * This is the main entry point for deploying applications to ecloud TEE.
 * It orchestrates all the steps: build, push, encrypt, and deploy on-chain.
 * 
 * NOTE: This SDK function is non-interactive. All required parameters must be
 * provided explicitly. Use the CLI for interactive parameter collection.
 */

import { DeployResult, Logger, AppProfile } from "../../common/types";
import { ensureDockerIsRunning } from "../../common/docker/build";
import { prepareRelease } from "../../common/release/prepare";
import {
  deployApp,
  calculateAppID,
  getMaxActiveAppsPerUser,
  getActiveAppCount,
} from "../../common/contract/caller";
import { watchUntilRunning } from "../../common/contract/watcher";
import {
  validateAppName,
  validateLogVisibility,
  assertValidImageReference,
  assertValidFilePath,
  LogVisibility,
} from "../../common/utils/validation";
import { doPreflightChecks, PreflightContext } from "../../common/utils/preflight";
import { UserApiClient } from "../../common/utils/userapi";
import { setAppName } from "../../common/registry/appNames";
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
  /** Optional app profile to upload after deployment */
  profile?: AppProfile;
  /** Optional gas params from estimation */
  gas?: {
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
  };
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
 * 8. Upload profile if provided
 * 9. Save the app name mapping
 * 10. Watch until app is running
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
  const environment = preflightCtx.environmentConfig.name;

  // 5. Generate random salt
  const salt = generateRandomSalt();
  logger.debug(`Generated salt: ${Buffer.from(salt).toString("hex")}`);

  // 6. Get app ID (calculate from salt and address)
  logger.debug("Calculating app ID...");
  const appIDToBeDeployed = await calculateAppID(
    preflightCtx.privateKey,
    options.rpcUrl || preflightCtx.rpcUrl,
    preflightCtx.environmentConfig,
    salt,
  );
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
      instanceType,
      environmentConfig: preflightCtx.environmentConfig,
      appID: appIDToBeDeployed,
    },
    logger,
  );

  // 8. Deploy the app
  logger.info("Deploying on-chain...");
  const deployedAppID = await deployApp(
    {
      privateKey: preflightCtx.privateKey,
      rpcUrl: options.rpcUrl || preflightCtx.rpcUrl,
      environmentConfig: preflightCtx.environmentConfig,
      salt,
      release,
      publicLogs,
      imageRef: finalImageRef,
      gas: options.gas,
    },
    logger,
  );

  // 9. Upload profile if provided (non-blocking - warn on failure but don't fail deployment)
  if (options.profile) {
    logger.info("Uploading app profile...");
    try {
      const userApiClient = new UserApiClient(
        preflightCtx.environmentConfig,
        preflightCtx.privateKey,
        preflightCtx.rpcUrl,
      );

      await userApiClient.uploadAppProfile(
        deployedAppID.appAddress,
        options.profile.name,
        options.profile.website,
        options.profile.description,
        options.profile.xURL,
        options.profile.imagePath,
      );
      logger.info("✓ Profile uploaded successfully");
    } catch (err: any) {
      logger.warn(`Failed to upload profile: ${err.message}`);
    }
  }

  // 10. Save the app name mapping
  try {
    await setAppName(environment, deployedAppID.appAddress, appName);
    logger.info(`App saved with name: ${appName}`);
  } catch (err: any) {
    logger.warn(`Failed to save app name: ${err.message}`);
  }

  // 11. Watch until app is running
  logger.info("Waiting for app to start...");
  const ipAddress = await watchUntilRunning(
    {
      privateKey: preflightCtx.privateKey,
      rpcUrl: options.rpcUrl || preflightCtx.rpcUrl,
      environmentConfig: preflightCtx.environmentConfig,
      appID: deployedAppID.appAddress,
    },
    logger,
  );

  return {
    appID: deployedAppID.appAddress,
    txHash: deployedAppID.txHash,
    appName,
    imageRef: finalImageRef,
    ipAddress,
  };
}

/**
 * Check quota availability - verifies that the user has deployment quota available
 * by checking their allowlist status on the contract
 */
async function checkQuotaAvailable(
  preflightCtx: PreflightContext,
): Promise<void> {
  const rpcUrl = preflightCtx.rpcUrl;
  const environmentConfig = preflightCtx.environmentConfig;
  const userAddress = preflightCtx.selfAddress;

  // Check user's quota limit from contract
  let maxQuota: number;
  try {
    maxQuota = await getMaxActiveAppsPerUser(
      rpcUrl,
      environmentConfig,
      userAddress,
    );
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
    activeCount = await getActiveAppCount(
      rpcUrl,
      environmentConfig,
      userAddress,
    );
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

// Re-export for convenience
export { extractAppNameFromImage } from "../../common/utils/validation";
