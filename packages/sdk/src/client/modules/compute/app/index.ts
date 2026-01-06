/**
 * Main App namespace entry point
 */

import { parseAbi, encodeFunctionData, Hex, type WalletClient, type PublicClient } from "viem";
import {
  deploy as deployApp,
  prepareDeploy as prepareDeployFn,
  prepareDeployFromVerifiableBuild as prepareDeployFromVerifiableBuildFn,
  executeDeploy as executeDeployFn,
  watchDeployment as watchDeploymentFn,
} from "./deploy";
import {
  upgrade as upgradeApp,
  prepareUpgrade as prepareUpgradeFn,
  prepareUpgradeFromVerifiableBuild as prepareUpgradeFromVerifiableBuildFn,
  executeUpgrade as executeUpgradeFn,
  watchUpgrade as watchUpgradeFn,
} from "./upgrade";
import { createApp, CreateAppOpts } from "./create";
import { logs, LogsOptions } from "./logs";

import { getEnvironmentConfig } from "../../../common/config/environment";
import {
  sendAndWaitForTransaction,
  undelegate,
  isDelegated,
  type GasEstimate,
} from "../../../common/contract/caller";
import { withSDKTelemetry } from "../../../common/telemetry/wrapper";
import { UserApiClient } from "../../../common/utils/userapi";

import type {
  AppId,
  DeployAppOpts,
  LifecycleOpts,
  UpgradeAppOpts,
  AppProfile,
  AppProfileResponse,
  ExecuteDeployResult,
  ExecuteUpgradeResult,
  PrepareDeployOpts,
  PrepareDeployFromVerifiableBuildOpts,
  PrepareUpgradeOpts,
  PrepareUpgradeFromVerifiableBuildOpts,
  PreparedDeploy,
  PreparedUpgrade,
} from "../../../common/types";
import { getLogger } from "../../../common/utils";

// Minimal ABI
const CONTROLLER_ABI = parseAbi([
  "function startApp(address appId)",
  "function stopApp(address appId)",
  "function terminateApp(address appId)",
]);

/**
 * Encode start app call data for gas estimation
 */
export function encodeStartAppData(appId: AppId): Hex {
  return encodeFunctionData({
    abi: CONTROLLER_ABI,
    functionName: "startApp",
    args: [appId],
  });
}

/**
 * Encode stop app call data for gas estimation
 */
export function encodeStopAppData(appId: AppId): Hex {
  return encodeFunctionData({
    abi: CONTROLLER_ABI,
    functionName: "stopApp",
    args: [appId],
  });
}

/**
 * Encode terminate app call data for gas estimation
 */
export function encodeTerminateAppData(appId: AppId): Hex {
  return encodeFunctionData({
    abi: CONTROLLER_ABI,
    functionName: "terminateApp",
    args: [appId],
  });
}

export interface AppModule {
  // Project creation
  create: (opts: CreateAppOpts) => Promise<void>;

  // Full deploy/upgrade
  deploy: (opts: DeployAppOpts) => Promise<{
    appId: AppId;
    tx: Hex;
    appName: string;
    imageRef: string;
    ipAddress?: string;
  }>;
  upgrade: (
    appId: AppId,
    opts: UpgradeAppOpts,
  ) => Promise<{ tx: Hex; appId: AppId; imageRef: string }>;

  // Granular deploy control
  prepareDeploy: (opts: PrepareDeployOpts) => Promise<{
    prepared: PreparedDeploy;
    gasEstimate: GasEstimate;
  }>;
  prepareDeployFromVerifiableBuild: (opts: PrepareDeployFromVerifiableBuildOpts) => Promise<{
    prepared: PreparedDeploy;
    gasEstimate: GasEstimate;
  }>;
  executeDeploy: (prepared: PreparedDeploy, gas?: GasEstimate) => Promise<ExecuteDeployResult>;
  watchDeployment: (appId: AppId) => Promise<string | undefined>;

  // Granular upgrade control
  prepareUpgrade: (
    appId: AppId,
    opts: PrepareUpgradeOpts,
  ) => Promise<{
    prepared: PreparedUpgrade;
    gasEstimate: GasEstimate;
  }>;
  prepareUpgradeFromVerifiableBuild: (
    appId: AppId,
    opts: PrepareUpgradeFromVerifiableBuildOpts,
  ) => Promise<{
    prepared: PreparedUpgrade;
    gasEstimate: GasEstimate;
  }>;
  executeUpgrade: (prepared: PreparedUpgrade, gas?: GasEstimate) => Promise<ExecuteUpgradeResult>;
  watchUpgrade: (appId: AppId) => Promise<void>;

  // Profile management
  setProfile: (appId: AppId, profile: AppProfile) => Promise<AppProfileResponse>;

  // Logs
  logs: (opts: LogsOptions) => Promise<void>;

  // Lifecycle
  start: (appId: AppId, opts?: LifecycleOpts) => Promise<{ tx: Hex | false }>;
  stop: (appId: AppId, opts?: LifecycleOpts) => Promise<{ tx: Hex | false }>;
  terminate: (appId: AppId, opts?: LifecycleOpts) => Promise<{ tx: Hex | false }>;

  // Delegation
  isDelegated: () => Promise<boolean>;
  undelegate: () => Promise<{ tx: Hex | false }>;
}

export interface AppModuleConfig {
  verbose?: boolean;
  walletClient: WalletClient;
  publicClient: PublicClient;
  environment: string;
  clientId?: string;
  skipTelemetry?: boolean; // Skip telemetry when called from CLI
}

export function createAppModule(ctx: AppModuleConfig): AppModule {
  const { walletClient, publicClient } = ctx;
  const skipTelemetry = ctx.skipTelemetry || false;

  // Validate that wallet client has an account attached
  if (!walletClient.account) {
    throw new Error("WalletClient must have an account attached");
  }
  const account = walletClient.account;

  // Pull config for selected Environment
  const environment = getEnvironmentConfig(ctx.environment);

  // Get logger that respects verbose setting
  const logger = getLogger(ctx.verbose);

  return {
    async create(opts) {
      return createApp(opts, logger);
    },
    // Write operations
    async deploy(opts) {
      // Map DeployAppOpts to SDKDeployOptions and call the deploy function
      const result = await deployApp(
        {
          walletClient,
          publicClient,
          environment: ctx.environment,
          appName: opts.name,
          instanceType: opts.instanceType,
          dockerfilePath: opts.dockerfile,
          envFilePath: opts.envFile,
          imageRef: opts.imageRef,
          logVisibility: opts.logVisibility,
          gas: opts.gas,
        },
        logger,
      );

      return {
        appId: result.appId as AppId,
        tx: result.txHash,
        ipAddress: result.ipAddress,
        appName: result.appName,
        imageRef: result.imageRef,
      };
    },

    async upgrade(appId, opts) {
      // Map UpgradeAppOpts to SDKUpgradeOptions and call the upgrade function
      const result = await upgradeApp(
        {
          appId: appId,
          walletClient,
          publicClient,
          environment: ctx.environment,
          instanceType: opts.instanceType,
          dockerfilePath: opts.dockerfile,
          envFilePath: opts.envFile,
          imageRef: opts.imageRef,
          logVisibility: opts.logVisibility,
          gas: opts.gas,
        },
        logger,
      );

      return {
        tx: result.txHash,
        appId: result.appId,
        imageRef: result.imageRef,
      };
    },

    // Granular deploy control
    async prepareDeploy(opts) {
      return prepareDeployFn(
        {
          walletClient,
          publicClient,
          environment: ctx.environment,
          appName: opts.name,
          instanceType: opts.instanceType,
          dockerfilePath: opts.dockerfile,
          envFilePath: opts.envFile,
          imageRef: opts.imageRef,
          logVisibility: opts.logVisibility,
          resourceUsageMonitoring: opts.resourceUsageMonitoring,
          skipTelemetry,
        },
        logger,
      );
    },

    async prepareDeployFromVerifiableBuild(opts) {
      return prepareDeployFromVerifiableBuildFn(
        {
          walletClient,
          publicClient,
          environment: ctx.environment,
          appName: opts.name,
          instanceType: opts.instanceType,
          envFilePath: opts.envFile,
          imageRef: opts.imageRef,
          imageDigest: opts.imageDigest,
          logVisibility: opts.logVisibility,
          resourceUsageMonitoring: opts.resourceUsageMonitoring,
          skipTelemetry,
        },
        logger,
      );
    },

    async executeDeploy(prepared, gas) {
      const result = await executeDeployFn({
        prepared,
        context: {
          walletClient,
          publicClient,
          environmentConfig: environment,
        },
        gas,
        logger,
        skipTelemetry,
      });
      return {
        appId: result.appId,
        txHash: result.txHash,
        appName: result.appName,
        imageRef: result.imageRef,
      };
    },

    async watchDeployment(appId) {
      return watchDeploymentFn(
        appId,
        walletClient,
        publicClient,
        environment,
        logger,
        skipTelemetry,
      );
    },

    // Granular upgrade control
    async prepareUpgrade(appId, opts) {
      return prepareUpgradeFn(
        {
          appId,
          walletClient,
          publicClient,
          environment: ctx.environment,
          instanceType: opts.instanceType,
          dockerfilePath: opts.dockerfile,
          envFilePath: opts.envFile,
          imageRef: opts.imageRef,
          logVisibility: opts.logVisibility,
          resourceUsageMonitoring: opts.resourceUsageMonitoring,
          skipTelemetry,
        },
        logger,
      );
    },

    async prepareUpgradeFromVerifiableBuild(appId, opts) {
      return prepareUpgradeFromVerifiableBuildFn(
        {
          appId,
          walletClient,
          publicClient,
          environment: ctx.environment,
          instanceType: opts.instanceType,
          envFilePath: opts.envFile,
          imageRef: opts.imageRef,
          imageDigest: opts.imageDigest,
          logVisibility: opts.logVisibility,
          resourceUsageMonitoring: opts.resourceUsageMonitoring,
          skipTelemetry,
        },
        logger,
      );
    },

    async executeUpgrade(prepared, gas) {
      const result = await executeUpgradeFn({
        prepared,
        context: {
          walletClient,
          publicClient,
          environmentConfig: environment,
        },
        gas,
        logger,
        skipTelemetry,
      });
      return {
        appId: result.appId,
        txHash: result.txHash,
        imageRef: result.imageRef,
      };
    },

    async watchUpgrade(appId) {
      return watchUpgradeFn(
        appId,
        walletClient,
        publicClient,
        environment,
        logger,
        skipTelemetry,
      );
    },

    // Profile management
    async setProfile(appId, profile) {
      return withSDKTelemetry(
        {
          functionName: "setProfile",
          skipTelemetry,
          properties: { environment: ctx.environment },
        },
        async () => {
          const userApiClient = new UserApiClient(
            environment,
            walletClient,
            publicClient,
            ctx.clientId,
          );
          return userApiClient.uploadAppProfile(appId, profile.name, {
            website: profile.website,
            description: profile.description,
            xURL: profile.xURL,
            // Note: imagePath conversion to Blob should be handled by caller (CLI)
          });
        },
      );
    },

    async logs(opts) {
      return logs(
        {
          appID: opts.appID,
          watch: opts.watch,
          clientId: ctx.clientId,
        },
        walletClient,
        publicClient,
        environment,
        logger,
        skipTelemetry,
      );
    },

    async start(appId, opts) {
      return withSDKTelemetry(
        {
          functionName: "start",
          skipTelemetry: skipTelemetry, // Skip if called from CLI
          properties: { environment: ctx.environment },
        },
        async () => {
          const pendingMessage = `Starting app ${appId}...`;

          const data = encodeFunctionData({
            abi: CONTROLLER_ABI,
            functionName: "startApp",
            args: [appId],
          });

          const tx = await sendAndWaitForTransaction(
            {
              walletClient,
              publicClient,
              environmentConfig: environment,
              to: environment.appControllerAddress,
              data,
              pendingMessage,
              txDescription: "StartApp",
              gas: opts?.gas,
            },
            logger,
          );
          return { tx };
        },
      );
    },

    async stop(appId, opts) {
      return withSDKTelemetry(
        {
          functionName: "stop",
          skipTelemetry: skipTelemetry, // Skip if called from CLI
          properties: { environment: ctx.environment },
        },
        async () => {
          const pendingMessage = `Stopping app ${appId}...`;

          const data = encodeFunctionData({
            abi: CONTROLLER_ABI,
            functionName: "stopApp",
            args: [appId],
          });

          const tx = await sendAndWaitForTransaction(
            {
              walletClient,
              publicClient,
              environmentConfig: environment,
              to: environment.appControllerAddress,
              data,
              pendingMessage,
              txDescription: "StopApp",
              gas: opts?.gas,
            },
            logger,
          );
          return { tx };
        },
      );
    },

    async terminate(appId, opts) {
      return withSDKTelemetry(
        {
          functionName: "terminate",
          skipTelemetry: skipTelemetry, // Skip if called from CLI
          properties: { environment: ctx.environment },
        },
        async () => {
          const pendingMessage = `Terminating app ${appId}...`;

          const data = encodeFunctionData({
            abi: CONTROLLER_ABI,
            functionName: "terminateApp",
            args: [appId],
          });

          const tx = await sendAndWaitForTransaction(
            {
              walletClient,
              publicClient,
              environmentConfig: environment,
              to: environment.appControllerAddress,
              data,
              pendingMessage,
              txDescription: "TerminateApp",
              gas: opts?.gas,
            },
            logger,
          );
          return { tx };
        },
      );
    },

    async isDelegated() {
      return isDelegated({
        publicClient,
        environmentConfig: environment,
        address: account.address,
      });
    },

    async undelegate() {
      return withSDKTelemetry(
        {
          functionName: "undelegate",
          skipTelemetry: skipTelemetry, // Skip if called from CLI
          properties: { environment: ctx.environment },
        },
        async () => {
          // perform the undelegate EIP7702 tx (sets delegated to zero address)
          const tx = await undelegate(
            {
              walletClient,
              publicClient,
              environmentConfig: environment,
            },
            logger,
          );

          return { tx };
        },
      );
    },
  };
}
