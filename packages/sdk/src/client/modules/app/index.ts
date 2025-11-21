/**
 * Main App namespace entry point
 */

import { parseAbi, encodeFunctionData } from "viem"; // decodeEventLog
import { deploy as deployApp } from "./deploy";
import { upgrade as upgradeApp } from "./upgrade";
import { createApp, CreateAppOpts } from "./create";
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

// Minimal ABI
const CONTROLLER_ABI = parseAbi([
  // "function upgradeApp(address appId, string image)",
  "function startApp(address appId)",
  "function stopApp(address appId)",
  "function terminateApp(address appId)",
]);

export interface AppModule {
  create: (opts: CreateAppOpts) => Promise<void>;
  deploy: (opts: DeployAppOpts) => Promise<{ appId: AppId; tx: `0x${string}` }>;
  upgrade: (
    appId: AppId,
    opts: UpgradeAppOpts,
  ) => Promise<{ tx: `0x${string}` }>;
  lifecycle: {
    start: (appId: AppId, opts?: LifecycleOpts) => Promise<{ tx: `0x${string}` }>;
    stop: (appId: AppId, opts?: LifecycleOpts) => Promise<{ tx: `0x${string}` }>;
    terminate: (
      appId: AppId,
      opts?: LifecycleOpts,
    ) => Promise<{ tx: `0x${string}` }>;
  }
}

export function createAppModule(ctx: CoreContext): AppModule {
  const { wallet } = ctx;

  const chain = wallet.chain!;
  const account = wallet.account!;

  const environment = getEnvironmentConfig(ctx.environment);

  const logger = getLogger(ctx.verbose);

  // Helper to merge user gas overrides
  const gas = (g?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }) =>
    g
      ? {
          maxFeePerGas: g.maxFeePerGas,
          maxPriorityFeePerGas: g.maxPriorityFeePerGas,
        }
      : {};

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
        appId: result.appID as AppId,
        tx: result.txHash,
      };
    },

    async upgrade(appId, opts) {
      // Map UpgradeAppOpts to UpgradeOptions and call the upgrade function
      const result = await upgradeApp(
        {
          appID: appId,
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
      };
    },

    lifecycle: {
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
        let confirmationPrompt = "⚠️  **Permanently** destroy app";
        let pendingMessage = "Terminating app...";
        if (appName !== "") {
          confirmationPrompt = `${confirmationPrompt} '${appName}'`;
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
    }
  };
}
