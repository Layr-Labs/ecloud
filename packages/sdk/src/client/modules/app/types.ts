import { Address } from "viem";

export type AppId = Address & { readonly __brand: unique symbol };

export interface DeployAppOpts {
  image: string; // or content hash
  owner?: `0x${string}`;
  resources?: { cpu?: number; memoryMiB?: number };
  salt?: `0x${string}`;
  gas?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint };
}

export interface UpgradeAppOpts {
  image: string;
  gas?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint };
}

export interface LifecycleOpts {
  gas?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint };
}

export interface AppRecord {
  id: AppId;
  owner: `0x${string}`;
  image: string;
  status: "starting" | "running" | "stopped" | "terminated";
  createdAt: number; // epoch ms
  lastUpdatedAt: number; // epoch ms
}
