/**
 * Core types for ECloud SDK
 */

import { Address, Hex } from "viem";
import { GasEstimate } from "../contract/caller";

export type AppId = Address;

export type logVisibility = "public" | "private" | "off";

export interface DeployAppOpts {
  /** App name - required */
  name: string;
  /** Path to Dockerfile (if building from Dockerfile) - either this or imageRef is required */
  dockerfile?: string;
  /** Path to .env file - optional */
  envFile?: string;
  /** Image reference (registry/path:tag) - either this or dockerfile is required */
  imageRef?: string;
  /** Instance type SKU - required */
  instanceType: string;
  /** Log visibility setting - required */
  logVisibility: logVisibility;
  /** Optional gas params from estimation */
  gas?: GasEstimate;
}

export interface UpgradeAppOpts {
  /** Path to Dockerfile (if building from Dockerfile) - either this or imageRef is required */
  dockerfile?: string;
  /** Image reference (registry/path:tag) - either this or dockerfile is required */
  imageRef?: string;
  /** Path to .env file - optional */
  envFile?: string;
  /** Instance type SKU - required */
  instanceType: string;
  /** Log visibility setting - required */
  logVisibility: logVisibility;
  gas?: GasEstimate;
}

/** Options for prepareDeploy */
export interface PrepareDeployOpts {
  /** App name - required */
  name: string;
  /** Path to Dockerfile (if building from Dockerfile) */
  dockerfile?: string;
  /** Path to .env file - optional */
  envFile?: string;
  /** Image reference (registry/path:tag) */
  imageRef?: string;
  /** Instance type SKU - required */
  instanceType: string;
  /** Log visibility setting - required */
  logVisibility: logVisibility;
  /** Resource usage monitoring setting - optional */
  resourceUsageMonitoring?: "enable" | "disable";
}

/** Options for prepareUpgrade */
export interface PrepareUpgradeOpts {
  /** Path to Dockerfile (if building from Dockerfile) */
  dockerfile?: string;
  /** Image reference (registry/path:tag) */
  imageRef?: string;
  /** Path to .env file - optional */
  envFile?: string;
  /** Instance type SKU - required */
  instanceType: string;
  /** Log visibility setting - required */
  logVisibility: logVisibility;
  /** Resource usage monitoring setting - optional */
  resourceUsageMonitoring?: "enable" | "disable";
}

/** Options for prepareDeployFromVerifiableBuild */
export interface PrepareDeployFromVerifiableBuildOpts {
  /** App name - required */
  name: string;
  /** Image reference (registry/path:tag) - required */
  imageRef: string;
  /** Image digest (sha256:...) - required */
  imageDigest: string;
  /** Path to .env file - optional */
  envFile?: string;
  /** Instance type SKU - required */
  instanceType: string;
  /** Log visibility setting - required */
  logVisibility: logVisibility;
  /** Resource usage monitoring setting - optional */
  resourceUsageMonitoring?: "enable" | "disable";
}

/** Options for prepareUpgradeFromVerifiableBuild */
export interface PrepareUpgradeFromVerifiableBuildOpts {
  /** Image reference (registry/path:tag) - required */
  imageRef: string;
  /** Image digest (sha256:...) - required */
  imageDigest: string;
  /** Path to .env file - optional */
  envFile?: string;
  /** Instance type SKU - required */
  instanceType: string;
  /** Log visibility setting - required */
  logVisibility: logVisibility;
  /** Resource usage monitoring setting - optional */
  resourceUsageMonitoring?: "enable" | "disable";
}

/** Gas options for execute functions */
export interface GasOpts {
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

/** Result from executeDeploy */
export interface ExecuteDeployResult {
  appId: AppId;
  txHash: Hex;
  appName: string;
  imageRef: string;
}

/** Result from executeUpgrade */
export interface ExecuteUpgradeResult {
  appId: AppId;
  txHash: Hex;
  imageRef: string;
}

/** Data-only batch for deploy (clients provided by module) */
export interface PreparedDeployData {
  /** The app ID that will be deployed */
  appId: AppId;
  /** The salt used for deployment */
  salt: Uint8Array;
  /** Batch executions to be sent */
  executions: Array<{ target: Address; value: bigint; callData: Hex }>;
}

/** Data-only batch for upgrade (clients provided by module) */
export interface PreparedUpgradeData {
  /** The app ID being upgraded */
  appId: AppId;
  /** Batch executions to be sent */
  executions: Array<{ target: Address; value: bigint; callData: Hex }>;
}

/** Prepared deployment ready for execution */
export interface PreparedDeploy {
  /** The prepared data (executions, appId, etc.) */
  data: PreparedDeployData;
  /** App name */
  appName: string;
  /** Final image reference */
  imageRef: string;
}

/** Prepared upgrade ready for execution */
export interface PreparedUpgrade {
  /** The prepared data (executions, appId, etc.) */
  data: PreparedUpgradeData;
  /** App ID being upgraded */
  appId: AppId;
  /** Final image reference */
  imageRef: string;
}

export interface LifecycleOpts {
  gas?: GasEstimate;
}

export interface AppRecord {
  id: AppId;
  owner: Address;
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
  appId: AppId;
  /** App name */
  appName: string;
  /** Final image reference */
  imageRef: string;
  /** IP address (if available) */
  ipAddress?: string;
  /** Transaction hash */
  txHash: Hex;
}

export interface BillingEnvironmentConfig {
  billingApiServerURL: string;
}

export interface EnvironmentConfig {
  name: string;
  build: "dev" | "prod";
  chainID: bigint;
  appControllerAddress: Address;
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

/**
 * No-op logger for browser usage when logging is not needed
 */
export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Profile information for an app
 */
export interface AppProfile {
  /** App name (required) */
  name: string;
  /** Website URL (optional) */
  website?: string;
  /** Description (optional) */
  description?: string;
  /** X (Twitter) URL (optional) */
  xURL?: string;
  /** Path to image file (optional) */
  image?: Blob | File;
  /** Image name (optional) */
  imageName?: string;
}

/**
 * Profile response from API
 */
export interface AppProfileResponse {
  name: string;
  website?: string;
  description?: string;
  xURL?: string;
  imageURL?: string;
}

// Billing types
export type ProductID = "compute";
export type ChainID = "ethereum-mainnet" | "ethereum-sepolia";

export type SubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused"
  | "inactive";

export interface SubscriptionLineItem {
  description: string;
  price: number;
  quantity: number;
  currency: string;
  subtotal: number;
}

export interface CreateSubscriptionResponse {
  checkoutUrl: string;
}

export interface CheckoutCreatedResponse {
  type: "checkout_created";
  checkoutUrl: string;
}

export interface AlreadyActiveResponse {
  type: "already_active";
  status: SubscriptionStatus;
}

export interface PaymentIssueResponse {
  type: "payment_issue";
  status: SubscriptionStatus;
  portalUrl?: string;
}

export type SubscribeResponse =
  | CheckoutCreatedResponse
  | AlreadyActiveResponse
  | PaymentIssueResponse;

export interface CancelSuccessResponse {
  type: "canceled";
}

export interface NoActiveSubscriptionResponse {
  type: "no_active_subscription";
  status: SubscriptionStatus;
}

export type CancelResponse = CancelSuccessResponse | NoActiveSubscriptionResponse;

export interface ProductSubscriptionResponse {
  productId: ProductID;
  subscriptionStatus: SubscriptionStatus;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  lineItems?: SubscriptionLineItem[];
  upcomingInvoiceSubtotal?: number;
  upcomingInvoiceTotal?: number;
  creditsApplied?: number;
  remainingCredits?: number;
  nextCreditExpiry?: number;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: string;
  portalUrl?: string;
}

export interface SubscriptionOpts {
  productId?: ProductID;
}

// Billing environment configuration
export interface BillingEnvironmentConfig {
  billingApiServerURL: string;
}
