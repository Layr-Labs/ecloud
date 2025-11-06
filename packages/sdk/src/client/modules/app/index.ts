import type { CoreContext } from "../..";
import type {
  AppId,
  DeployAppOpts,
  LifecycleOpts,
  // UpgradeAppOpts,
} from "./types";
import { parseAbi, type Address } from "viem"; // decodeEventLog
import { deploy as deployApp } from "./deploy/deploy";

// TODO: source addresses (using zeus?)
const ADDR: Record<number, { factory: Address; controller: Address }> = {
  1: { factory: "0xFactoryMainnet", controller: "0xControllerMainnet" },
  11155111: { factory: "0xFactorySepolia", controller: "0xControllerSepolia" },
};

// Minimal ABI
const CONTROLLER_ABI = parseAbi([
  // "function upgradeApp(address appId, string image)",
  "function startApp(address appId)",
  "function stopApp(address appId)",
  "function terminateApp(address appId)",
]);

export interface AppModule {
  deploy: (opts: DeployAppOpts) => Promise<{ appId: AppId; tx: `0x${string}` }>;
  start: (appId: AppId, opts?: LifecycleOpts) => Promise<{ tx: `0x${string}` }>;
  stop: (appId: AppId, opts?: LifecycleOpts) => Promise<{ tx: `0x${string}` }>;
  terminate: (
    appId: AppId,
    opts?: LifecycleOpts,
  ) => Promise<{ tx: `0x${string}` }>;
  // upgrade: (
  //   appId: AppId,
  //   opts: UpgradeAppOpts,
  // ) => Promise<{ tx: `0x${string}` }>;
}

export function createAppModule(ctx: CoreContext): AppModule {
  const addresses = ADDR[ctx.chain.id];
  if (!addresses)
    throw new Error(`No contract addresses for chain ${ctx.chain.id}`);

  const { wallet, publicClient } = ctx;

  const chain = wallet.chain!;
  const account = wallet.account!;

  // Helper to merge user gas overrides
  const gas = (g?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }) =>
    g
      ? {
          maxFeePerGas: g.maxFeePerGas,
          maxPriorityFeePerGas: g.maxPriorityFeePerGas,
        }
      : {};

  return {
    // Write operations
    async deploy(opts) {
      // Map DeployAppOpts to DeployOptions and call the deploy function
      const result = await deployApp(
        {
          privateKey: ctx.privateKey,
          rpcUrl: ctx.rpcUrl,
          environment: ctx.environment,
          imageRef: opts.image,
          instanceType: "standard", // Default instance type
          logRedirect: "console", // Default log redirect
          publicLogs: false, // Default to private logs
          dockerfilePath: undefined,
          envFilePath: undefined,
          appName: undefined,
        },
        {
          debug: () => {}, // Silent logger for SDK usage
          info: () => {},
          warn: () => {},
          error: (msg: string, ...args: any[]) => {
            console.error(msg, ...args);
          },
        }
      );

      return {
        appId: result.appID as AppId,
        tx: result.txHash,
      };
    },

    async start(appId, opts) {
      const tx = await wallet.writeContract({
        chain,
        account,
        address: addresses.controller,
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
        address: addresses.controller,
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
        address: addresses.controller,
        abi: CONTROLLER_ABI,
        functionName: "terminateApp",
        args: [appId],
        ...gas(opts?.gas),
      });
      return { tx };
    },

    // async upgrade(appId, opts) {
    //   const tx = await wallet.writeContract({
    //     chain,
    //     account,
    //     address: addresses.controller,
    //     abi: CONTROLLER_ABI,
    //     functionName: "upgrade",
    //     args: [appId, opts.image],
    //     ...gas(opts.gas),
    //   });
    //   return { tx };
    // },
  };
}
