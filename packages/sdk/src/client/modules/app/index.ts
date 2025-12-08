/**
 * Main App namespace entry point
 */

import { parseAbi, encodeFunctionData } from "viem";
import { deploy as deployApp } from "./deploy";
import { upgrade as upgradeApp } from "./upgrade";
import { createApp, CreateAppOpts } from "./create";
import { logs, LogsOptions } from "./logs";

import { getAppName } from "../../common/registry/appNames";
import { getEnvironmentConfig } from "../../common/config/environment";
import { sendAndWaitForTransaction, undelegate } from "../../common/contract/caller";

import type {
  AppId,
  DeployAppOpts,
  LifecycleOpts,
  UpgradeAppOpts,
} from "../../common/types";
import { getLogger, addHexPrefix } from "../../common/utils";

// Minimal ABI
const CONTROLLER_ABI = parseAbi([
  "function startApp(address appId)",
  "function stopApp(address appId)",
  "function terminateApp(address appId)",
]);

export interface AppModule {
  create: (opts: CreateAppOpts) => Promise<void>;
  deploy: (opts: DeployAppOpts) => Promise<{ appID: AppId; tx: `0x${string}`; appName: string; imageRef: string; ipAddress?: string; }>;
  upgrade: (
    appID: AppId,
    opts: UpgradeAppOpts,
  ) => Promise<{ tx: `0x${string}`, appID: string, imageRef: string; }>;
  logs: (opts: LogsOptions) => Promise<void>;
  start: (appId: AppId, opts?: LifecycleOpts) => Promise<{ tx: `0x${string}` | false }>;
  stop: (appId: AppId, opts?: LifecycleOpts) => Promise<{ tx: `0x${string}` | false }>;
  terminate: (
    appId: AppId,
    opts?: LifecycleOpts,
  ) => Promise<{ tx: `0x${string}` | false }>;
  undelegate: () => Promise<{ tx: `0x${string}` | false }>;
}

export interface AppModuleConfig {
    verbose?: boolean;
    privateKey: `0x${string}`;
    rpcUrl: string;
    environment: string;
}

export function createAppModule(ctx: AppModuleConfig): AppModule {
  const privateKey = addHexPrefix(ctx.privateKey);

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
          privateKey,
          rpcUrl: ctx.rpcUrl,
          environment: ctx.environment,
          appName: opts.name,
          instanceType: opts.instanceType,
          dockerfilePath: opts.dockerfile,
          envFilePath: opts.envFile,
          imageRef: opts.imageRef,
          logVisibility: opts.logVisibility,
          profile: opts.profile,
        },
        logger,
      );

      return {
        appID: result.appID as AppId,
        tx: result.txHash,
        ipAddress: result.ipAddress,
        appName: result.appName,
        imageRef: result.imageRef,
      };
    },

    async upgrade(appID, opts) {
      // Map UpgradeAppOpts to SDKUpgradeOptions and call the upgrade function
      const result = await upgradeApp(
        {
          appID: appID,
          privateKey,
          rpcUrl: ctx.rpcUrl,
          environment: ctx.environment,
          instanceType: opts.instanceType,
          dockerfilePath: opts.dockerfile,
          envFilePath: opts.envFile,
          imageRef: opts.imageRef,
          logVisibility: opts.logVisibility,
        },
        logger,
      );

      return {
        tx: result.txHash,
        appID: result.appID,
        imageRef: result.imageRef,
      };
    },

    async logs(opts) {
      return logs(
        {
          privateKey,
          appID: opts.appID,
          watch: opts.watch,
          environment: ctx.environment,
        },
        logger,
      );
    },

    async start(appId) {
      const appName = getAppName(ctx.environment, appId);
      let pendingMessage = "Starting app...";
      if (appName !== "") {
        pendingMessage = `Starting app '${appName}'...`;
      }

      const data = encodeFunctionData({
        abi: CONTROLLER_ABI,
        functionName: "startApp",
        args: [appId],
      });

      const tx = await sendAndWaitForTransaction(
        {
          privateKey,
          rpcUrl: ctx.rpcUrl,
          environmentConfig: environment,
          to: environment.appControllerAddress as `0x${string}`,
          data,
          pendingMessage,
          txDescription: "StartApp",
        },
        logger,
      );
      return { tx };
    },

    async stop(appId) {
      const appName = getAppName(ctx.environment, appId);
      let pendingMessage = "Stopping app...";
      if (appName !== "") {
        pendingMessage = `Stopping app '${appName}'...`;
      }

      const data = encodeFunctionData({
        abi: CONTROLLER_ABI,
        functionName: "stopApp",
        args: [appId],
      });

      const tx = await sendAndWaitForTransaction(
        {
          privateKey,
          rpcUrl: ctx.rpcUrl,
          environmentConfig: environment,
          to: environment.appControllerAddress as `0x${string}`,
          data,
          pendingMessage,
          txDescription: "StopApp",
        },
        logger,
      );
      return { tx };
    },

    async terminate(appId) {
      const appName = getAppName(ctx.environment, appId);
      let pendingMessage = "Terminating app...";
      if (appName !== "") {
        pendingMessage = `Terminating app '${appName}'...`;
      }

      const data = encodeFunctionData({
        abi: CONTROLLER_ABI,
        functionName: "terminateApp",
        args: [appId],
      });

      const tx = await sendAndWaitForTransaction(
        {
          privateKey,
          rpcUrl: ctx.rpcUrl,
          environmentConfig: environment,
          to: environment.appControllerAddress as `0x${string}`,
          data,
          pendingMessage,
          txDescription: "TerminateApp",
        },
        logger,
      );
      return { tx };
    },

    async undelegate() {
      // perform the undelegate EIP7702 tx (sets delegated to zero address)
      const tx = await undelegate({
        privateKey,
        rpcUrl: ctx.rpcUrl,
        environmentConfig: environment,
      }, logger);

      return { tx };
    }
  };
}
