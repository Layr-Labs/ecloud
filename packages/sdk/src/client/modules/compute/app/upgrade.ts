/**
 * Main upgrade function
 *
 * This is the main entry point for upgrading existing applications on ecloud TEE.
 * It orchestrates all the steps: build, push, encrypt, and upgrade on-chain.
 *
 * NOTE: This SDK function is non-interactive. All required parameters must be
 * provided explicitly. Use the CLI for interactive parameter collection.
 */

import { Address, Hex } from "viem";
import type { WalletClient, PublicClient } from "viem";
import {
  Logger,
  AppId,
  PreparedUpgrade,
  PreparedUpgradeData,
  EnvironmentConfig,
} from "../../../common/types";
import { ensureDockerIsRunning } from "../../../common/docker/build";
import { prepareRelease } from "../../../common/release/prepare";
import { createReleaseFromImageDigest } from "../../../common/release/prebuilt";
import {
  upgradeApp,
  prepareUpgradeBatch,
  executeUpgradeBatch,
  type GasEstimate,
} from "../../../common/contract/caller";
import { estimateBatchGas, createAuthorizationList } from "../../../common/contract/eip7702";
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
import { withSDKTelemetry } from "../../../common/telemetry/wrapper";

/**
 * Required upgrade options for SDK (non-interactive)
 */
export interface SDKUpgradeOptions {
  /** App ID to upgrade - required */
  appId: string | Address;
  /** Wallet client for signing transactions */
  walletClient: WalletClient;
  /** Public client for reading blockchain state */
  publicClient: PublicClient;
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
  /** Optional gas params from estimation (use result from prepareUpgrade) */
  gas?: GasEstimate;
  /** Skip telemetry (used when called from CLI) - optional */
  skipTelemetry?: boolean;
}

export interface UpgradeResult {
  /** App ID (contract address) */
  appId: AppId;
  /** Final image reference */
  imageRef: string;
  /** Transaction hash */
  txHash: Hex;
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

/** Options for executing a prepared upgrade */
export interface ExecuteUpgradeOptions {
  prepared: PreparedUpgrade;
  context: {
    walletClient: WalletClient;
    publicClient: PublicClient;
    environmentConfig: EnvironmentConfig;
  };
  gas?: GasEstimate;
  logger?: Logger;
  skipTelemetry?: boolean;
}

/**
 * Prepare an upgrade from a pre-built image (already layered) without using Docker locally.
 *
 * Intended for verifiable builds: build service provides imageRef + imageDigest (sha256:...).
 * This skips:
 * - ensureDockerIsRunning()
 * - prepareRelease() layering/digest extraction
 */
export async function prepareUpgradeFromVerifiableBuild(
  options: Omit<SDKUpgradeOptions, "gas" | "dockerfilePath" | "imageRef"> & {
    imageRef: string;
    imageDigest: string; // sha256:...
    skipTelemetry?: boolean;
  },
  logger: Logger = defaultLogger,
): Promise<PrepareUpgradeResult> {
  return withSDKTelemetry(
    {
      functionName: "prepareUpgradeFromVerifiableBuild",
      skipTelemetry: options.skipTelemetry,
      properties: {
        environment: options.environment || "sepolia",
      },
    },
    async () => {
      // Preflight checks
      logger.debug("Performing preflight checks...");
      const preflightCtx = await doPreflightChecks(
        {
          walletClient: options.walletClient,
          publicClient: options.publicClient,
          environment: options.environment,
        },
        logger,
      );

      // Validate required parameters
      const appID = validateUpgradeOptions(options as SDKUpgradeOptions);
      assertValidImageReference(options.imageRef);
      if (!/^sha256:[0-9a-f]{64}$/i.test(options.imageDigest)) {
        throw new Error(
          `imageDigest must be in format sha256:<64 hex>, got: ${options.imageDigest}`,
        );
      }

      const { publicLogs } = validateLogVisibility(options.logVisibility);
      validateResourceUsageMonitoring(options.resourceUsageMonitoring);
      const envFilePath = options.envFilePath || "";

      // Build Release struct WITHOUT Docker/layering
      logger.info("Preparing release (verifiable build, no local layering)...");
      const release = await createReleaseFromImageDigest(
        {
          imageRef: options.imageRef,
          imageDigest: options.imageDigest,
          envFilePath,
          instanceType: options.instanceType,
          environmentConfig: preflightCtx.environmentConfig,
          appId: appID as string,
        },
        logger,
      );

      // Check permission state
      logger.debug("Checking current log permission state...");
      const currentlyPublic = await checkAppLogPermission(preflightCtx, appID, logger);
      const needsPermissionChange = currentlyPublic !== publicLogs;

      // Prepare upgrade batch (no send)
      logger.debug("Preparing upgrade batch...");
      const batch = await prepareUpgradeBatch({
        walletClient: preflightCtx.walletClient,
        publicClient: preflightCtx.publicClient,
        environmentConfig: preflightCtx.environmentConfig,
        appID: appID,
        release,
        publicLogs,
        needsPermissionChange,
        imageRef: options.imageRef,
      });

      // Create authorization list if not delegated (for accurate gas estimation)
      logger.debug("Checking delegation status...");
      const authorizationList = await createAuthorizationList({
        walletClient: batch.walletClient,
        publicClient: batch.publicClient,
        environmentConfig: batch.environmentConfig,
      });

      logger.debug("Estimating gas...");
      const gasEstimate = await estimateBatchGas({
        publicClient: batch.publicClient,
        account: batch.walletClient.account!.address,
        executions: batch.executions,
        authorizationList,
      });

      // Extract only data fields for public type (clients stay internal)
      const data: PreparedUpgradeData = {
        appId: batch.appId,
        executions: batch.executions,
        authorizationList,
      };

      return {
        prepared: {
          data,
          appId: appID as Address,
          imageRef: options.imageRef,
        },
        gasEstimate,
      };
    },
  );
}

/**
 * Validate upgrade options and throw descriptive errors for missing/invalid params
 */
function validateUpgradeOptions(options: SDKUpgradeOptions): Address {
  // Wallet client with account is required
  if (!options.walletClient?.account) {
    throw new Error("walletClient with account is required for upgrade");
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
  return withSDKTelemetry(
    {
      functionName: "upgrade",
      skipTelemetry: options.skipTelemetry,
      properties: {
        environment: options.environment || "sepolia",
      },
    },
    async () => {
      // 1. Do preflight checks (auth, network, etc.) first
      logger.debug("Performing preflight checks...");
      const preflightCtx = await doPreflightChecks(
        {
          walletClient: options.walletClient,
          publicClient: options.publicClient,
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
          appId: appID,
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
          walletClient: preflightCtx.walletClient,
          publicClient: preflightCtx.publicClient,
          environmentConfig: preflightCtx.environmentConfig,
          appID: appID,
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
          walletClient: preflightCtx.walletClient,
          publicClient: preflightCtx.publicClient,
          environmentConfig: preflightCtx.environmentConfig,
          appId: appID,
        },
        logger,
      );

      return {
        appId: appID,
        imageRef: finalImageRef,
        txHash,
      };
    },
  );
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
  options: Omit<SDKUpgradeOptions, "gas"> & { skipTelemetry?: boolean },
  logger: Logger = defaultLogger,
): Promise<PrepareUpgradeResult> {
  return withSDKTelemetry(
    {
      functionName: "prepareUpgrade",
      skipTelemetry: options.skipTelemetry,
      properties: {
        environment: options.environment || "sepolia",
      },
    },
    async () => {
      // 1. Do preflight checks (auth, network, etc.) first
      logger.debug("Performing preflight checks...");
      const preflightCtx = await doPreflightChecks(
        {
          walletClient: options.walletClient,
          publicClient: options.publicClient,
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
          appId: appID,
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
        walletClient: preflightCtx.walletClient,
        publicClient: preflightCtx.publicClient,
        environmentConfig: preflightCtx.environmentConfig,
        appID: appID,
        release,
        publicLogs,
        needsPermissionChange,
        imageRef: finalImageRef,
      });

      // 7. Create authorization list if not delegated (for accurate gas estimation)
      logger.debug("Checking delegation status...");
      const authorizationList = await createAuthorizationList({
        walletClient: batch.walletClient,
        publicClient: batch.publicClient,
        environmentConfig: batch.environmentConfig,
      });

      // 8. Estimate gas for the batch
      logger.debug("Estimating gas...");
      const gasEstimate = await estimateBatchGas({
        publicClient: batch.publicClient,
        account: batch.walletClient.account!.address,
        executions: batch.executions,
        authorizationList,
      });

      // Extract only data fields for public type (clients stay internal)
      const data: PreparedUpgradeData = {
        appId: batch.appId,
        executions: batch.executions,
        authorizationList,
      };

      return {
        prepared: {
          data,
          appId: appID,
          imageRef: finalImageRef,
        },
        gasEstimate,
      };
    },
  );
}

/**
 * Execute a prepared upgrade
 *
 * Call this after prepareUpgrade and user confirmation.
 * Note: This only submits the on-chain transaction. Call watchUpgrade separately
 * to wait for the upgrade to complete.
 */
export async function executeUpgrade(options: ExecuteUpgradeOptions): Promise<UpgradeResult> {
  const { prepared, context, gas, logger = defaultLogger, skipTelemetry } = options;

  return withSDKTelemetry(
    {
      functionName: "executeUpgrade",
      skipTelemetry: skipTelemetry,
    },
    async () => {
      // Execute the batch transaction
      logger.info("Upgrading on-chain...");
      const txHash = await executeUpgradeBatch(prepared.data, context, gas, logger);

      return {
        appId: prepared.appId,
        imageRef: prepared.imageRef,
        txHash,
      };
    },
  );
}

/**
 * Watch an upgrade until it completes
 *
 * Call this after executeUpgrade to wait for the upgrade to finish.
 * Can be called separately to allow for intermediate operations.
 */
export async function watchUpgrade(
  appId: string,
  walletClient: WalletClient,
  publicClient: PublicClient,
  environmentConfig: EnvironmentConfig,
  logger: Logger = defaultLogger,
  skipTelemetry?: boolean,
): Promise<void> {
  return withSDKTelemetry(
    {
      functionName: "watchUpgrade",
      skipTelemetry: skipTelemetry,
      properties: {
        environment: environmentConfig.name,
      },
    },
    async () => {
      logger.info("Waiting for upgrade to complete...");
      await watchUntilUpgradeComplete(
        {
          walletClient,
          publicClient,
          environmentConfig,
          appId: appId as Address,
        },
        logger,
      );
    },
  );
}
