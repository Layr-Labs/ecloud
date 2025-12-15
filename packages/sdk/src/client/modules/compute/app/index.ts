/**
 * Main App namespace entry point
 */

import { parseAbi, encodeFunctionData } from "viem";
import { deploy as deployApp } from "./deploy";
import { upgrade as upgradeApp } from "./upgrade";
import { createApp, CreateAppOpts } from "./create";
import { logs, LogsOptions } from "./logs";

import { getEnvironmentConfig } from "../../../common/config/environment";
import {
  sendAndWaitForTransaction,
  undelegate,
  isDelegated,
} from "../../../common/contract/caller";
import { withSDKTelemetry } from "../../../common/telemetry/wrapper";

import type { AppId, DeployAppOpts, LifecycleOpts, UpgradeAppOpts } from "../../../common/types";
import { getLogger, addHexPrefix } from "../../../common/utils";

// Minimal ABI
const CONTROLLER_ABI = parseAbi([
  "function startApp(address appId)",
  "function stopApp(address appId)",
  "function terminateApp(address appId)",
]);

/**
 * Encode start app call data for gas estimation
 */
export function encodeStartAppData(appId: AppId): `0x${string}` {
  return encodeFunctionData({
    abi: CONTROLLER_ABI,
    functionName: "startApp",
    args: [appId],
  });
}

/**
 * Encode stop app call data for gas estimation
 */
export function encodeStopAppData(appId: AppId): `0x${string}` {
  return encodeFunctionData({
    abi: CONTROLLER_ABI,
    functionName: "stopApp",
    args: [appId],
  });
}

/**
 * Encode terminate app call data for gas estimation
 */
export function encodeTerminateAppData(appId: AppId): `0x${string}` {
  return encodeFunctionData({
    abi: CONTROLLER_ABI,
    functionName: "terminateApp",
    args: [appId],
  });
}

export interface AppModule {
  create: (opts: CreateAppOpts) => Promise<void>;
  deploy: (opts: DeployAppOpts) => Promise<{
    appId: AppId;
    tx: `0x${string}`;
    appName: string;
    imageRef: string;
    ipAddress?: string;
  }>;
  upgrade: (
    appId: AppId,
    opts: UpgradeAppOpts,
  ) => Promise<{ tx: `0x${string}`; appId: string; imageRef: string }>;
  logs: (opts: LogsOptions) => Promise<void>;
  start: (appId: AppId, opts?: LifecycleOpts) => Promise<{ tx: `0x${string}` | false }>;
  stop: (appId: AppId, opts?: LifecycleOpts) => Promise<{ tx: `0x${string}` | false }>;
  terminate: (appId: AppId, opts?: LifecycleOpts) => Promise<{ tx: `0x${string}` | false }>;
  isDelegated: () => Promise<boolean>;
  undelegate: () => Promise<{ tx: `0x${string}` | false }>;
}

export interface AppModuleConfig {
  verbose?: boolean;
  privateKey: `0x${string}`;
  rpcUrl: string;
  environment: string;
  clientId?: string;
  skipTelemetry?: boolean; // Skip telemetry when called from CLI
}

export function createAppModule(ctx: AppModuleConfig): AppModule {
  const privateKey = addHexPrefix(ctx.privateKey);
  const skipTelemetry = ctx.skipTelemetry || false;

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
          privateKey,
          rpcUrl: ctx.rpcUrl,
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

    async logs(opts) {
      return logs(
        {
          privateKey,
          appID: opts.appID,
          watch: opts.watch,
          environment: ctx.environment,
          clientId: ctx.clientId,
        },
        logger,
        skipTelemetry, // Skip if called from CLI
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
              privateKey,
              rpcUrl: ctx.rpcUrl,
              environmentConfig: environment,
              to: environment.appControllerAddress as `0x${string}`,
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
              privateKey,
              rpcUrl: ctx.rpcUrl,
              environmentConfig: environment,
              to: environment.appControllerAddress as `0x${string}`,
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
              privateKey,
              rpcUrl: ctx.rpcUrl,
              environmentConfig: environment,
              to: environment.appControllerAddress as `0x${string}`,
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
        privateKey,
        rpcUrl: ctx.rpcUrl,
        environmentConfig: environment,
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
              privateKey,
              rpcUrl: ctx.rpcUrl,
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
