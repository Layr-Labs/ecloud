/**
 * Main upgrade function
 *
 * This is the main entry point for upgrading existing applications on ecloud TEE.
 * It orchestrates all the steps: build, push, encrypt, and upgrade on-chain.
 */

import { Address } from "viem";
import { Logger } from "../../common/types";
import { ensureDockerIsRunning } from "../../common/docker/build";
import { prepareRelease } from "../../common/release/prepare";
import { upgradeApp } from "../../common/contract/caller";
import { watchUntilUpgradeComplete } from "../../common/contract/watcher";
import {
  getDockerfileInteractive,
  getImageReferenceInteractive,
  getEnvFileInteractive,
  getInstanceTypeInteractive,
  getLogSettingsInteractive,
  getOrPromptAppID,
} from "../../common/utils/prompts";
import { doPreflightChecks, PreflightContext } from "../../common/utils/preflight";
import { UserApiClient } from "../../common/utils/userapi";
import { checkAppLogPermission } from "../../common/utils/permissions";
import { getCurrentInstanceType } from "../../common/utils/instance";
import { defaultLogger } from "../../common/utils";

export interface UpgradeOptions {
  /** App ID to upgrade - optional, will prompt if not provided */
  appID?: string | Address;
  /** Private key for signing transactions (hex string with or without 0x prefix) - optional, will prompt if not provided */
  privateKey?: string;
  /** RPC URL for blockchain connection - optional, uses environment default if not provided */
  rpcUrl?: string;
  /** Environment name (e.g., 'sepolia', 'mainnet-alpha') - optional, defaults to 'sepolia' */
  environment?: string;
  /** Path to Dockerfile (if building from Dockerfile) */
  dockerfilePath?: string;
  /** Image reference (registry/path:tag) - optional, will prompt if not provided */
  imageRef?: string;
  /** Path to .env file - optional, will use .env if exists or prompt */
  envFilePath?: string;
  /** Instance type - optional, will prompt if not provided */
  instanceType?: string;
  /** Log visibility setting - optional, will prompt if not provided */
  logVisibility?: "public" | "private" | "off";
}

export interface UpgradeResult {
  /** App ID (contract address) */
  appID: string;
  /** Final image reference */
  imageRef: string;
  /** Transaction hash */
  txHash: `0x${string}`;
}

/**
 * Upgrade an existing application on ECloud TEE
 *
 * This function follows the exact same flow as the Go CLI upgrade command:
 * 1. Preflight checks (auth, network, etc.)
 * 2. Ensure Docker is running
 * 3. Get app ID from args or interactive selection
 * 4. Check for Dockerfile before asking for image reference
 * 5. Get image reference (context-aware based on Dockerfile decision)
 * 6. Get environment file configuration
 * 7. Get current app's instance type (best-effort, used as default for selection)
 * 8. Get instance type selection (defaults to current app's instance type)
 * 9. Get log settings from flags or interactive prompt
 * 10. Prepare the release (includes build/push if needed, with automatic retry on permission errors)
 * 11. Check current permission state and determine if change is needed
 * 12. Upgrade the app
 * 13. Watch until upgrade completes
 */
export async function upgrade(
  options: Partial<UpgradeOptions>,
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

  // 2. Check if docker is running, else try to start it
  logger.debug("Checking Docker...");
  await ensureDockerIsRunning();

  // 3. Get app ID from args or interactive selection
  const appID = await getOrPromptAppID(
    options.appID,
    preflightCtx.environmentConfig.name,
  );

  // 4. Check for Dockerfile before asking for image reference
  const dockerfilePath = await getDockerfileInteractive(
    options.dockerfilePath,
  );
  const buildFromDockerfile = dockerfilePath !== "";

  // 5. Get image reference (context-aware based on Dockerfile decision)
  const imageRef = await getImageReferenceInteractive(
    options.imageRef,
    buildFromDockerfile,
  );

  // 6. Get environment file configuration
  const envFilePath = await getEnvFileInteractive(options.envFilePath);

  // 7. Get current app's instance type (best-effort, used as default for selection)
  const currentInstanceType = await getCurrentInstanceType(
    preflightCtx,
    appID,
    logger,
  );

  // 8. Get instance type selection (defaults to current app's instance type)
  const availableTypes = await fetchAvailableInstanceTypes(
    preflightCtx,
    logger,
  );
  const instanceType = await getInstanceTypeInteractive(
    options.instanceType,
    currentInstanceType,
    availableTypes,
  );

  // 9. Get log settings from flags or interactive prompt
  const logSettings = await getLogSettingsInteractive(
    options.logVisibility as "public" | "private" | "off" | undefined,
  );
  const { logRedirect, publicLogs } = logSettings;

  // 10. Prepare the release (includes build/push if needed, with automatic retry on permission errors)
  logger.info("Preparing release...");
  const { release, finalImageRef } = await prepareRelease(
    {
      dockerfilePath,
      imageRef,
      envFilePath,
      logRedirect,
      instanceType,
      environmentConfig: preflightCtx.environmentConfig,
      appID: appID as string,
    },
    logger,
  );

  // 11. Check current permission state and determine if change is needed
  logger.debug("Checking current log permission state...");
  const currentlyPublic = await checkAppLogPermission(
    preflightCtx,
    appID,
    logger,
  );
  const needsPermissionChange = currentlyPublic !== publicLogs;

  // 12. Upgrade the app
  logger.info("Upgrading on-chain...");
  const txHash = await upgradeApp(
    {
      privateKey: preflightCtx.privateKey,
      rpcUrl: options.rpcUrl || preflightCtx.rpcUrl,
      environmentConfig: preflightCtx.environmentConfig,
      appID,
      release,
      publicLogs,
      needsPermissionChange,
      imageRef: finalImageRef,
    },
    logger,
  );

  // 13. Watch until upgrade completes
  logger.info("Waiting for upgrade to complete...");
  await watchUntilUpgradeComplete(
    {
      privateKey: preflightCtx.privateKey,
      rpcUrl: options.rpcUrl || preflightCtx.rpcUrl,
      environmentConfig: preflightCtx.environmentConfig,
      appID,
    },
    logger,
  );

  return {
    appID: appID as string,
    imageRef: finalImageRef,
    txHash,
  };
}

/**
 * Fetch available instance types from backend
 */
async function fetchAvailableInstanceTypes(
  preflightCtx: PreflightContext,
  logger: Logger,
): Promise<Array<{ sku: string; description: string }>> {
  try {
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
