/**
 * Core types for ECloud SDK
 */

import { Address } from "viem";

export type AppId = Address;

export type logVisibility = "public" | "private" | "off";

export interface DeployAppOpts {
  name?: string;
  dockerfile?: string;
  envFile?: string;
  imageRef?: string;
  instanceType?: string;
  logVisibility?: logVisibility;
}

export interface UpgradeAppOpts {
  /** Path to Dockerfile (if building from Dockerfile) */
  dockerfile?: string;
  /** Image reference (registry/path:tag) - optional, will prompt if not provided */
  imageRef?: string;
  /** Path to .env file - optional, will use .env if exists or prompt */
  envFile?: string;
  /** Instance type - optional, will prompt if not provided */
  instanceType?: string;
  /** Log visibility setting - optional, will prompt if not provided */
  logVisibility?: logVisibility;
  gas?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint };
}

export interface LifecycleOpts {
  gas?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint };
  force?: boolean; // For terminate: skip confirmation if true
}

export interface AppRecord {
  id: AppId;
  owner: `0x${string}`;
  image: string;
  status: "starting" | "running" | "stopped" | "terminated";
  createdAt: number; // epoch ms
  lastUpdatedAt: number; // epoch ms
}

export interface DeployOptions {
  /** Private key for signing transactions (hex string with or without 0x prefix) - optional, will prompt if not provided */
  privateKey?: string;
  /** RPC URL for blockchain connection - optional, uses environment default if not provided */
  rpcUrl?: string;
  /** Environment name (e.g., 'sepolia', 'mainnet-alpha') - optional, defaults to 'sepolia' */
  environment?: string;
  /** Path to Dockerfile (if building from Dockerfile) */
  dockerfilePath?: string;
  /** Image reference (registry/path:tag) - optional, will prompt if not provided */
  imageRef?: string;
  /** Path to .env file - optional, will use .env if exists or prompt */
  envFilePath?: string;
  /** App name - optional, will prompt if not provided */
  appName?: string;
  /** Instance type - optional, will prompt if not provided */
  instanceType?: string;
  /** Log visibility setting - optional, will prompt if not provided */
  logVisibility?: logVisibility;
}

export interface DeployResult {
  /** App ID (contract address) */
  appID: string;
  /** App name */
  appName: string;
  /** Final image reference */
  imageRef: string;
  /** IP address (if available) */
  ipAddress?: string;
  /** Transaction hash */
  txHash: `0x${string}`;
}

export interface EnvironmentConfig {
  name: string;
  chainID: bigint;
  appControllerAddress: string;
  permissionControllerAddress: string;
  erc7702DelegatorAddress: string;
  kmsServerURL: string;
  userApiServerURL: string;
  defaultRPCURL: string;
}

export interface Release {
  rmsRelease: {
    artifacts: Array<{
      digest: Uint8Array; // 32 bytes
      registry: string;
    }>;
    upgradeByTime: number; // Unix timestamp
  };
  publicEnv: Uint8Array; // JSON bytes
  encryptedEnv: Uint8Array; // Encrypted string bytes
}

export interface ParsedEnvironment {
  public: Record<string, string>;
  private: Record<string, string>;
}

export interface ImageDigestResult {
  digest: Uint8Array; // 32 bytes
  registry: string;
  platform: string;
}

export interface DockerImageConfig {
  cmd: string[];
  entrypoint: string[];
  user: string;
  labels: Record<string, string>;
}

export interface Logger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}
