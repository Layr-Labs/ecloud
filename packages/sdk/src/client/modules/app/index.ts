/**
 * Main App namespace entry point
 */

import { parseAbi, encodeFunctionData } from "viem"; // decodeEventLog
import { deploy as deployApp } from "./deploy";
import { upgrade as upgradeApp } from "./upgrade";
import { createApp, CreateAppOpts } from "./create";
import { logs, LogsOptions } from "./logs";
import { sendAndWaitForTransaction } from "../../common/contract/caller";
import { getAppName } from "../../common/registry/appNames";

import { getEnvironmentConfig } from "../../common/config/environment";

import type { CoreContext } from "../..";
import type {
  AppId,
  DeployAppOpts,
  LifecycleOpts,
  UpgradeAppOpts,
} from "../../common/types";
import { getLogger } from "../../common/utils";
import chalk from "chalk";

// Minimal ABI
const CONTROLLER_ABI = parseAbi([
  // "function upgradeApp(address appId, string image)",
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
}

export function createAppModule(ctx: CoreContext): AppModule {
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
      // Map DeployAppOpts to DeployOptions and call the deploy function
      const result = await deployApp(
        {
          privateKey: ctx.privateKey,
          rpcUrl: ctx.rpcUrl,
          environment: ctx.environment,
          appName: opts.name,
          instanceType: opts.instanceType,
          dockerfilePath: opts.dockerfile,
          envFilePath: opts.envFile,
          imageRef: opts.imageRef,
          logVisibility: opts.logVisibility,
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
      // Map UpgradeAppOpts to UpgradeOptions and call the upgrade function
      const result = await upgradeApp(
        {
          appID: appID,
          privateKey: ctx.privateKey,
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
          appID: opts.appID,
          watch: opts.watch,
          environment: ctx.environment,
          privateKey: ctx.privateKey,
        },
        logger,
      );
    },

    async start(appId, opts) {
      // Get app name for confirmation prompt (matches Go implementation)
      const appName = getAppName(ctx.environment, appId);
      let confirmationPrompt = "Start app";
      let pendingMessage = "Starting app...";
      if (appName !== "") {
        confirmationPrompt = `${confirmationPrompt} '${appName}'`;
        pendingMessage = `Starting app '${appName}'...`;
      }

      const data = encodeFunctionData({
        abi: CONTROLLER_ABI,
        functionName: "startApp",
        args: [appId],
      });

      const tx = await sendAndWaitForTransaction(
        {
          privateKey: ctx.privateKey,
          rpcUrl: ctx.rpcUrl,
          environmentConfig: environment,
          to: environment.appControllerAddress as `0x${string}`,
          data,
          needsConfirmation: environment.chainID === 1n, // Mainnet needs confirmation
          confirmationPrompt,
          pendingMessage,
          txDescription: "StartApp",
        },
        logger,
      );
      return { tx };
    },

    async stop(appId, opts) {
      // Get app name for confirmation prompt (matches Go implementation)
      const appName = getAppName(ctx.environment, appId);
      let confirmationPrompt = "Stop app";
      let pendingMessage = "Stopping app...";
      if (appName !== "") {
        confirmationPrompt = `${confirmationPrompt} '${appName}'`;
        pendingMessage = `Stopping app '${appName}'...`;
      }

      const data = encodeFunctionData({
        abi: CONTROLLER_ABI,
        functionName: "stopApp",
        args: [appId],
      });

      const tx = await sendAndWaitForTransaction(
        {
          privateKey: ctx.privateKey,
          rpcUrl: ctx.rpcUrl,
          environmentConfig: environment,
          to: environment.appControllerAddress as `0x${string}`,
          data,
          needsConfirmation: environment.chainID === 1n, // Mainnet needs confirmation
          confirmationPrompt,
          pendingMessage,
          txDescription: "StopApp",
        },
        logger,
      );
      return { tx };
    },

    async terminate(appId, opts) {
      // Get app name for confirmation prompt (matches Go implementation)
      const appName = getAppName(ctx.environment, appId);
      let confirmationPrompt = `⚠️  ${chalk.bold("Permanently")} ${chalk.reset("destroy app")}`;
      let pendingMessage = "Terminating app...";
      if (appName !== "") {
        confirmationPrompt = `${confirmationPrompt} '${chalk.bold(appName)}'`;
        pendingMessage = `Terminating app '${appName}'...`;
      }

      // Note: Terminate always needs confirmation unless force is specified
      const force = opts?.force || false;

      const data = encodeFunctionData({
        abi: CONTROLLER_ABI,
        functionName: "terminateApp",
        args: [appId],
      });

      const tx = await sendAndWaitForTransaction(
        {
          privateKey: ctx.privateKey,
          rpcUrl: ctx.rpcUrl,
          environmentConfig: environment,
          to: environment.appControllerAddress as `0x${string}`,
          data,
          needsConfirmation: !force, // Terminate always needs confirmation unless force is specified
          confirmationPrompt,
          pendingMessage,
          txDescription: "TerminateApp",
        },
        logger,
      );
      return { tx };
    },
  };
}
