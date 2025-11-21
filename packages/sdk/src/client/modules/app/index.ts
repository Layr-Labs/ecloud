/**
 * Main App namespace entry point
 */

import { parseAbi } from "viem"; // decodeEventLog
import { deploy as deployApp } from "./deploy";
import { upgrade as upgradeApp } from "./upgrade";
import { createApp, CreateAppOpts } from "./create";

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
  start: (appId: AppId, opts?: LifecycleOpts) => Promise<{ tx: `0x${string}` }>;
  stop: (appId: AppId, opts?: LifecycleOpts) => Promise<{ tx: `0x${string}` }>;
  terminate: (
    appId: AppId,
    opts?: LifecycleOpts,
  ) => Promise<{ tx: `0x${string}` }>;
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

    async start(appId, opts) {
      const tx = await wallet.writeContract({
        chain,
        account,
        address: environment.appControllerAddress as `0x${string}`,
        abi: CONTROLLER_ABI,
        functionName: "startApp",
        args: [appId],
        ...gas(opts?.gas),
      });
      return { tx };
    },

    async stop(appId, opts) {
      const tx = await wallet.writeContract({
        chain,
        account,
        address: environment.appControllerAddress as `0x${string}`,
        abi: CONTROLLER_ABI,
        functionName: "stopApp",
        args: [appId],
        ...gas(opts?.gas),
      });
      return { tx };
    },

    async terminate(appId, opts) {
      const tx = await wallet.writeContract({
        chain,
        account,
        address: environment.appControllerAddress as `0x${string}`,
        abi: CONTROLLER_ABI,
        functionName: "terminateApp",
        args: [appId],
        ...gas(opts?.gas),
      });
      return { tx };
    },
  };
}
