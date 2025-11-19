/**
 * Main deploy function
 *
 * This is the main entry point for deploying applications to ecloud TEE.
 * It orchestrates all the steps: build, push, encrypt, and deploy on-chain.
 */

import { DeployOptions, DeployResult, Logger } from "../../common/types";
import { ensureDockerIsRunning } from "../../common/docker/build";
import { prepareRelease } from "../../common/release/prepare";
import { deployApp, calculateAppID } from "../../common/contract/caller";
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
 * 2. Ensure Docker is running
 * 3. Check for Dockerfile before asking for image reference
 * 4. Get image reference (context-aware based on Dockerfile decision)
 * 5. Get app name upfront (before any expensive operations)
 * 6. Get environment file configuration
 * 7. Get instance type selection
 * 8. Get log settings from flags or interactive prompt
 * 9. Generate random salt
 * 10. Get app ID (calculate from salt and address)
 * 11. Prepare the release (includes build/push if needed)
 * 12. Deploy the app
 * 13. Save the app name mapping
 * 14. Watch until app is running
 */
export async function deploy(
  options: Partial<DeployOptions>,
  logger: Logger = defaultLogger,
): Promise<DeployResult> {
  // 1. Do preflight checks (auth, network, etc.) first
  logger.debug("Performing preflight checks...");
  const preflightCtx = await doPreflightChecks(options, logger);

  // 2. Check if docker is running, else try to start it
  logger.debug("Checking Docker...");
  await ensureDockerIsRunning();

  // 3. Check for Dockerfile before asking for image reference
  const dockerfilePath = await getDockerfileInteractive(options.dockerfilePath);
  const buildFromDockerfile = dockerfilePath !== "";

  // 4. Get image reference (context-aware based on Dockerfile decision)
  const imageRef = await getImageReferenceInteractive(
    options.imageRef,
    buildFromDockerfile,
  );

  // 5. Get app name upfront (before any expensive operations)
  const environment = preflightCtx.environmentConfig.name;
  const appName = await getOrPromptAppName(
    options.appName,
    environment,
    imageRef,
  );

  // 6. Get environment file configuration
  const envFilePath = await getEnvFileInteractive(options.envFilePath);

  // 7. Get instance type selection (uses first from backend as default for new apps)
  const availableTypes = await fetchAvailableInstanceTypes(
    preflightCtx,
    logger,
  );
  const instanceType = await getInstanceTypeInteractive(
    options.instanceType,
    "", // defaultSKU - empty for new deployments
    availableTypes,
  );

  // 8. Get log settings from flags or interactive prompt
  const logSettings = await getLogSettingsInteractive(
    options.logVisibility as "public" | "private" | "off" | undefined,
  );
  const { logRedirect, publicLogs } = logSettings;

  // 9. Generate random salt
  const salt = generateRandomSalt();
  logger.debug(`Generated salt: ${Buffer.from(salt).toString("hex")}`);

  // 10. Get app ID (calculate from salt and address)
  logger.debug("Calculating app ID...");
  const appIDToBeDeployed = await calculateAppID(
    preflightCtx.privateKey,
    options.rpcUrl || preflightCtx.rpcUrl,
    preflightCtx.environmentConfig,
    salt,
  );
  logger.info(`App ID: ${appIDToBeDeployed}`);

  // 11. Prepare the release (includes build/push if needed, with automatic retry on permission errors)
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

  // 12. Deploy the app
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

  // 13. Save the app name mapping
  try {
    await setAppName(environment, deployedAppID.appAddress, appName);
    logger.info(`App saved with name: ${appName}`);
  } catch (err: any) {
    logger.warn(`Failed to save app name: ${err.message}`);
  }

  // 14. Watch until app is running
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
