/**
 * Core types for ecloud SDK
 */

export interface DeployOptions {
  /** Private key for signing transactions (hex string with or without 0x prefix) */
  privateKey: string;
  /** RPC URL for blockchain connection */
  rpcUrl: string;
  /** Environment name (e.g., 'sepolia', 'mainnet-alpha') */
  environment: string;
  /** Path to Dockerfile (if building from Dockerfile) */
  dockerfilePath?: string;
  /** Image reference (registry/path:tag) */
  imageRef: string;
  /** Path to .env file */
  envFilePath?: string;
  /** App name (optional, will be prompted if not provided) */
  appName?: string;
  /** Instance type */
  instanceType: string;
  /** Log redirect setting */
  logRedirect: string;
  /** Whether logs should be public */
  publicLogs: boolean;
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

