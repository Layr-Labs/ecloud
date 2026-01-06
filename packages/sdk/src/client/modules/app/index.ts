/**
 * Main App namespace entry point
 */

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { deploy as deployApp } from "./deploy";
import { upgrade as upgradeApp } from "./upgrade";

import { getEnvironmentConfig } from "../../common/config/environment";
import { sendAndWaitForTransaction, undelegate } from "../../common/contract/caller";
import { getChainFromID } from "../../common/utils/helpers";

import type { AppId, DeployAppOpts, LifecycleOpts, UpgradeAppOpts } from "../../common/types";
import { getLogger, addHexPrefix } from "../../common/utils";

// Re-export encoder functions from the browser-safe module
export {
  encodeStartAppData,
  encodeStopAppData,
  encodeTerminateAppData,
} from "../../common/contract/encoders";

// Minimal ABI for lifecycle operations (used internally)
const CONTROLLER_ABI = parseAbi([
  "function startApp(address appId)",
  "function stopApp(address appId)",
  "function terminateApp(address appId)",
]);

export interface AppModule {
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
  start: (appId: AppId, opts?: LifecycleOpts) => Promise<{ tx: `0x${string}` | false }>;
  stop: (appId: AppId, opts?: LifecycleOpts) => Promise<{ tx: `0x${string}` | false }>;
  terminate: (appId: AppId, opts?: LifecycleOpts) => Promise<{ tx: `0x${string}` | false }>;
  undelegate: () => Promise<{ tx: `0x${string}` | false }>;
}

export interface AppModuleConfig {
  verbose?: boolean;
  privateKey: `0x${string}`;
  rpcUrl: string;
  environment: string;
  clientId?: string;
}

export function createAppModule(ctx: AppModuleConfig): AppModule {
  const privateKeyHex = addHexPrefix(ctx.privateKey) as `0x${string}`;

  // Pull config for selected Environment
  const environmentConfig = getEnvironmentConfig(ctx.environment);

  // Get logger that respects verbose setting
  const logger = getLogger(ctx.verbose);

  // Create viem clients from privateKey and rpcUrl
  const chain = getChainFromID(environmentConfig.chainID);
  const account = privateKeyToAccount(privateKeyHex);

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(ctx.rpcUrl),
  }) as WalletClient;

  const publicClient = createPublicClient({
    chain,
    transport: http(ctx.rpcUrl),
  }) as PublicClient;

  return {
    // Write operations
    async deploy(opts) {
      // Map DeployAppOpts to SDKDeployOptions and call the deploy function
      const result = await deployApp(
        {
          privateKey: privateKeyHex,
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
          privateKey: privateKeyHex,
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

    async start(appId, opts) {
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
          environmentConfig,
          to: environmentConfig.appControllerAddress as `0x${string}`,
          data,
          pendingMessage,
          txDescription: "StartApp",
          gas: opts?.gas,
        },
        logger,
      );
      return { tx };
    },

    async stop(appId, opts) {
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
          environmentConfig,
          to: environmentConfig.appControllerAddress as `0x${string}`,
          data,
          pendingMessage,
          txDescription: "StopApp",
          gas: opts?.gas,
        },
        logger,
      );
      return { tx };
    },

    async terminate(appId, opts) {
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
          environmentConfig,
          to: environmentConfig.appControllerAddress as `0x${string}`,
          data,
          pendingMessage,
          txDescription: "TerminateApp",
          gas: opts?.gas,
        },
        logger,
      );
      return { tx };
    },

    async undelegate() {
      // perform the undelegate EIP7702 tx (sets delegated to zero address)
      const tx = await undelegate(
        {
          walletClient,
          publicClient,
          environmentConfig,
        },
        logger,
      );

      return { tx };
    },
  };
}
