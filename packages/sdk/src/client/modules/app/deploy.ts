/**
 * Main deploy function
 *
 * This is the main entry point for deploying applications to ecloud TEE.
 * It orchestrates all the steps: build, push, encrypt, and deploy on-chain.
 */

import { DeployOptions, DeployResult, Logger } from "../../common/types";
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
  getDockerfileInteractive,
  getImageReferenceInteractive,
  getOrPromptAppName,
  getEnvFileInteractive,
  getInstanceTypeInteractive,
  getLogSettingsInteractive,
} from "../../common/utils/prompts";
import { doPreflightChecks, PreflightContext } from "../../common/utils/preflight";
import { UserApiClient } from "../../common/utils/userapi";
import { setAppName } from "../../common/registry/appNames";
import { defaultLogger } from "../../common/utils";

/**
 * Deploy an application to ECloud TEE
 *
 * This function follows the exact same flow as the Go CLI deploy command:
 * 1. Preflight checks (auth, network, etc.)
 * 2. Check quota availability
 * 3. Ensure Docker is running
 * 4. Check for Dockerfile before asking for image reference
 * 5. Get image reference (context-aware based on Dockerfile decision)
 * 6. Get app name upfront (before any expensive operations)
 * 7. Get environment file configuration
 * 8. Get instance type selection
 * 9. Get log settings from flags or interactive prompt
 * 10. Generate random salt
 * 11. Get app ID (calculate from salt and address)
 * 12. Prepare the release (includes build/push if needed)
 * 13. Deploy the app
 * 14. Save the app name mapping
 * 15. Watch until app is running
 */
export async function deploy(
  options: Partial<DeployOptions>,
  logger: Logger = defaultLogger,
): Promise<DeployResult> {
  // 1. Do preflight checks (auth, network, etc.) first
  logger.debug("Performing preflight checks...");
  const preflightCtx = await doPreflightChecks(options, logger);

  // 2. Check quota availability
  logger.debug("Checking quota availability...");
  await checkQuotaAvailable(preflightCtx, logger);

  // 3. Check if docker is running, else try to start it
  logger.debug("Checking Docker...");
  await ensureDockerIsRunning();

  // 4. Check for Dockerfile before asking for image reference
  const dockerfilePath = await getDockerfileInteractive(options.dockerfilePath);
  const buildFromDockerfile = dockerfilePath !== "";

  // 5. Get image reference (context-aware based on Dockerfile decision)
  const imageRef = await getImageReferenceInteractive(
    options.imageRef,
    buildFromDockerfile,
  );

  // 6. Get app name upfront (before any expensive operations)
  const environment = preflightCtx.environmentConfig.name;
  const appName = await getOrPromptAppName(
    options.appName,
    environment,
    imageRef,
  );

  // 7. Get environment file configuration
  const envFilePath = await getEnvFileInteractive(options.envFilePath);

  // 8. Get instance type selection (uses first from backend as default for new apps)
  const availableTypes = await fetchAvailableInstanceTypes(
    preflightCtx,
    logger,
  );
  const instanceType = await getInstanceTypeInteractive(
    options.instanceType,
    "", // defaultSKU - empty for new deployments
    availableTypes,
  );

  // 9. Get log settings from flags or interactive prompt
  const logSettings = await getLogSettingsInteractive(
    options.logVisibility as "public" | "private" | "off" | undefined,
  );
  const { logRedirect, publicLogs } = logSettings;

  // 10. Generate random salt
  const salt = generateRandomSalt();
  logger.debug(`Generated salt: ${Buffer.from(salt).toString("hex")}`);

  // 11. Get app ID (calculate from salt and address)
  logger.debug("Calculating app ID...");
  const appIDToBeDeployed = await calculateAppID(
    preflightCtx.privateKey,
    options.rpcUrl || preflightCtx.rpcUrl,
    preflightCtx.environmentConfig,
    salt,
  );
  logger.info(`App ID: ${appIDToBeDeployed}`);

  // 12. Prepare the release (includes build/push if needed, with automatic retry on permission errors)
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

  // 13. Deploy the app
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
    },
    logger,
  );

  // 14. Save the app name mapping
  try {
    await setAppName(environment, deployedAppID.appAddress, appName);
    logger.info(`App saved with name: ${appName}`);
  } catch (err: any) {
    logger.warn(`Failed to save app name: ${err.message}`);
  }

  // 15. Watch until app is running
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
  logger: Logger,
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

/**
 * Fetch available instance types from backend
 */
async function fetchAvailableInstanceTypes(
  preflightCtx: PreflightContext,
  logger: Logger,
): Promise<Array<{ sku: string; description: string }>> {
  try{
    const userApiClient = new UserApiClient(
      preflightCtx.environmentConfig,
      preflightCtx.privateKey,
      preflightCtx.rpcUrl,
    );

    const skuList = await userApiClient.getSKUs();
    if (skuList.skus.length === 0) {
      throw new Error("No instance types available from server");
    }

    return skuList.skus;
  } catch (err: any) {
    logger.warn(`Failed to fetch instance types: ${err.message}`);
    // Return a default fallback
    return [{ sku: "standard", description: "Standard instance type" }];
  }
}
