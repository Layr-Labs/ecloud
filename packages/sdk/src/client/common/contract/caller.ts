/**
 * Contract interactions
 *
 * This module handles on-chain contract interactions using viem.
 *
 * Supports two modes:
 * 1. Private key mode: Pass privateKey + rpcUrl, clients are created internally
 * 2. Wallet client mode: Pass walletClient + publicClient directly (from wagmi/viem)
 */

import { privateKeyToAccount } from "viem/accounts";
import { executeBatch, checkERC7702Delegation } from "./eip7702";
import {
  createWalletClient,
  createPublicClient,
  http,
  Address,
  Hex,
  encodeFunctionData,
  decodeErrorResult,
  bytesToHex,
} from "viem";
import type { WalletClient, PublicClient, Chain } from "viem";

import { addHexPrefix, getChainFromID } from "../utils";

import { EnvironmentConfig, Logger, PreparedDeployData, PreparedUpgradeData } from "../types";
import { Release } from "../types";

import AppControllerABI from "../abis/AppController.json";
import PermissionControllerABI from "../abis/PermissionController.json";

/**
 * Gas estimation result
 */
export interface GasEstimate {
  /** Estimated gas limit for the transaction */
  gasLimit: bigint;
  /** Max fee per gas (EIP-1559) */
  maxFeePerGas: bigint;
  /** Max priority fee per gas (EIP-1559) */
  maxPriorityFeePerGas: bigint;
  /** Maximum cost in wei (gasLimit * maxFeePerGas) */
  maxCostWei: bigint;
  /** Maximum cost formatted as ETH string */
  maxCostEth: string;
}

/**
 * Options for estimating transaction gas
 */
export interface EstimateGasOptions {
  privateKey: string;
  rpcUrl: string;
  environmentConfig: EnvironmentConfig;
  to: Address;
  data: Hex;
  value?: bigint;
}

/**
 * Format Wei to ETH string
 */
export function formatETH(wei: bigint): string {
  const eth = Number(wei) / 1e18;
  const costStr = eth.toFixed(6);
  // Remove trailing zeros and decimal point if needed
  const trimmed = costStr.replace(/\.?0+$/, "");
  // If result is "0", show "<0.000001" for small amounts
  if (trimmed === "0" && wei > 0n) {
    return "<0.000001";
  }
  return trimmed;
}

/**
 * Estimate gas cost for a transaction
 *
 * Use this to get cost estimate before prompting user for confirmation.
 */
export async function estimateTransactionGas(options: EstimateGasOptions): Promise<GasEstimate> {
  const { privateKey, rpcUrl, environmentConfig, to, data, value = 0n } = options;

  const privateKeyHex = addHexPrefix(privateKey) as Hex;
  const account = privateKeyToAccount(privateKeyHex);

  const chain = getChainFromID(environmentConfig.chainID);

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  // Get current gas prices
  const fees = await publicClient.estimateFeesPerGas();

  // Estimate gas for the transaction
  const gasLimit = await publicClient.estimateGas({
    account: account.address,
    to,
    data,
    value,
  });

  const maxFeePerGas = fees.maxFeePerGas;
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas;
  const maxCostWei = gasLimit * maxFeePerGas;
  const maxCostEth = formatETH(maxCostWei);

  return {
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    maxCostWei,
    maxCostEth,
  };
}

/**
 * Base options shared by all operations
 */
interface BaseOptions {
  environmentConfig: EnvironmentConfig;
  gas?: GasEstimate;
}

/**
 * Private key mode: provide privateKey and rpcUrl, clients created internally
 */
interface PrivateKeyMode extends BaseOptions {
  privateKey: string;
  rpcUrl: string;
  walletClient?: never;
  publicClient?: never;
}

/**
 * Wallet client mode: provide walletClient and publicClient from wagmi/viem
 */
interface WalletClientModeOptions extends BaseOptions {
  walletClient: WalletClient;
  publicClient: PublicClient;
  privateKey?: never;
  rpcUrl?: never;
}

/**
 * Helper to create or use provided clients
 * Returns walletClient, publicClient, and whether we're using an external wallet
 */
function resolveClients(options: PrivateKeyMode | WalletClientModeOptions): {
  walletClient: WalletClient;
  publicClient: PublicClient;
  privateKeyHex: Hex | undefined;
  useWalletClient: boolean;
  chain: Chain;
} {
  const chain = getChainFromID(options.environmentConfig.chainID);
  if ("walletClient" in options && options.walletClient) {
    // Wallet client mode: use provided clients
    return {
      walletClient: options.walletClient,
      publicClient: options.publicClient,
      privateKeyHex: undefined,
      useWalletClient: true,
      chain,
    };
  } else {
    // Private key mode: create clients from privateKey
    const privKeyOptions = options as PrivateKeyMode;
    const privateKeyHex = addHexPrefix(privKeyOptions.privateKey) as Hex;
    const account = privateKeyToAccount(privateKeyHex);
    const chain = getChainFromID(options.environmentConfig.chainID);

    const publicClient = createPublicClient({
      chain,
      transport: http(privKeyOptions.rpcUrl),
    });
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(privKeyOptions.rpcUrl),
    });

    return {
      walletClient,
      publicClient,
      privateKeyHex,
      useWalletClient: false,
      chain,
    };
  }
}

/**
 * Deploy app options - supports both private key and wallet client modes
 */
export type DeployAppOptions = (PrivateKeyMode | WalletClientModeOptions) & {
  salt: Uint8Array;
  release: Release;
  publicLogs: boolean;
  imageRef: string;
};

/**
 * Private key mode options for calculateAppID
 */
interface CalculateAppIDPrivateKeyOptions {
  privateKey: string | Hex;
  rpcUrl: string;
  environmentConfig: EnvironmentConfig;
  salt: Uint8Array;
  address?: never;
  publicClient?: never;
}

/**
 * Prepared deploy batch ready for gas estimation and execution
 */
export interface PreparedDeployBatch {
  /** The app ID that will be deployed */
  appId: Address;
  /** The salt used for deployment */
  salt: Uint8Array;
  /** Batch executions to be sent */
  executions: Array<{ target: Address; value: bigint; callData: Hex }>;
  /** Wallet client for sending transaction */
  walletClient: WalletClient;
  /** Public client for reading chain state */
  publicClient: PublicClient;
  /** Environment configuration */
  environmentConfig: EnvironmentConfig;
  /** Whether to use wallet client signing */
  useWalletClient: boolean;
}

/**
 * Prepared upgrade batch ready for gas estimation and execution
 */
export interface PreparedUpgradeBatch {
  /** The app ID being upgraded */
  appId: Address;
  /** Batch executions to be sent */
  executions: Array<{ target: Address; value: bigint; callData: Hex }>;
  /** Wallet client for sending transaction */
  walletClient: WalletClient;
  /** Public client for reading chain state */
  publicClient: PublicClient;
  /** Environment configuration */
  environmentConfig: EnvironmentConfig;
  /** Whether to use wallet client signing */
  useWalletClient: boolean;
}

/**
 * Calculate app ID from owner address and salt
 * Wallet client mode options for calculateAppID
 */
interface CalculateAppIDWalletClientOptions {
  address: Address;
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  salt: Uint8Array;
  privateKey?: never;
  rpcUrl?: never;
}

// const chain = getChainFromID(environmentConfig.chainID);
/**
 * Options for calculateAppID - supports both private key and wallet client modes
 */
export type CalculateAppIDOptions =
  | CalculateAppIDPrivateKeyOptions
  | CalculateAppIDWalletClientOptions;

/**
 * Calculate app ID from owner address and salt
 *
 * Supports two modes:
 * - Private key mode: Pass { privateKey, rpcUrl, environmentConfig, salt }
 * - Wallet client mode: Pass { address, publicClient, environmentConfig, salt }
 */
export async function calculateAppID(options: CalculateAppIDOptions): Promise<Address> {
  const { environmentConfig, salt } = options;

  let ownerAddress: Address;
  let client: PublicClient;

  if ("privateKey" in options && options.privateKey) {
    // Private key mode: derive address from private key, create public client
    const privateKeyHex = addHexPrefix(options.privateKey);
    const account = privateKeyToAccount(privateKeyHex);
    ownerAddress = account.address;

    const chain = getChainFromID(environmentConfig.chainID);
    client = createPublicClient({
      chain,
      transport: http(options.rpcUrl),
    });
  } else {
    // Wallet client mode: use provided address and public client
    const walletClientOptions = options as CalculateAppIDWalletClientOptions;
    ownerAddress = walletClientOptions.address;
    client = walletClientOptions.publicClient;
  }

  // Ensure salt is properly formatted as hex string (32 bytes = 64 hex chars)
  // bytesToHex returns 0x-prefixed string, slice(2) removes the prefix for padding
  const saltHexString = bytesToHex(salt).slice(2);
  // Pad to 64 characters if needed
  const paddedSaltHex = saltHexString.padStart(64, "0");
  const saltHex = `0x${paddedSaltHex}` as Hex;

  // viem's account.address is always a string (Address type)

  const appID = await client.readContract({
    address: environmentConfig.appControllerAddress as Address,
    abi: AppControllerABI,
    functionName: "calculateAppId",
    args: [ownerAddress, saltHex],
  });

  return appID as Address;
}

/**
 * Options for preparing a deploy batch
 * Deploy app on-chain
 *
 * Supports two modes:
 * - Private key mode: Pass { privateKey, rpcUrl, environmentConfig, ... }
 * - Wallet client mode: Pass { walletClient, publicClient, environmentConfig, ... }
 */
export type PrepareDeployBatchOptions = (PrivateKeyMode | WalletClientModeOptions) & {
  salt: Uint8Array;
  release: Release;
  publicLogs: boolean;
  imageRef: string;
};

/**
 * Prepare deploy batch - creates executions without sending transaction
 *
 * Use this to get the prepared batch for gas estimation before executing.
 */
export async function prepareDeployBatch(
  options: PrepareDeployBatchOptions,
  logger: Logger,
): Promise<PreparedDeployBatch> {
  const { environmentConfig, salt, release, publicLogs } = options;

  // Resolve clients based on mode
  const { walletClient, publicClient, privateKeyHex, useWalletClient } = resolveClients(options);

  const account = walletClient.account;
  if (!account) {
    throw new Error("Wallet client must have an account");
  }

  // 1. Calculate app ID
  logger.info("Calculating app ID...");
  const appId = await calculateAppID(
    useWalletClient
      ? {
          address: account.address,
          publicClient,
          environmentConfig,
          salt,
        }
      : {
          privateKey: privateKeyHex!,
          rpcUrl: (options as PrivateKeyMode).rpcUrl,
          environmentConfig,
          salt,
        },
  );

  // Verify the app ID calculation matches what createApp will deploy
  logger.debug(`App ID calculated: ${appId}`);
  logger.debug(`This address will be used for acceptAdmin call`);

  // 2. Pack create app call
  const saltHexString = bytesToHex(salt).slice(2);
  const paddedSaltHex = saltHexString.padStart(64, "0");
  const saltHex = `0x${paddedSaltHex}` as Hex;

  // Convert Release Uint8Array values to hex strings for viem
  const releaseForViem = {
    rmsRelease: {
      artifacts: release.rmsRelease.artifacts.map((artifact) => ({
        digest: `0x${bytesToHex(artifact.digest).slice(2).padStart(64, "0")}` as Hex,
        registry: artifact.registry,
      })),
      upgradeByTime: release.rmsRelease.upgradeByTime,
    },
    publicEnv: bytesToHex(release.publicEnv) as Hex,
    encryptedEnv: bytesToHex(release.encryptedEnv) as Hex,
  };

  const createData = encodeFunctionData({
    abi: AppControllerABI,
    functionName: "createApp",
    args: [saltHex, releaseForViem],
  });

  // 3. Pack accept admin call
  const acceptAdminData = encodeFunctionData({
    abi: PermissionControllerABI,
    functionName: "acceptAdmin",
    args: [appId],
  });

  // 4. Assemble executions
  // CRITICAL: Order matters! createApp must complete first
  const executions: Array<{
    target: Address;
    value: bigint;
    callData: Hex;
  }> = [
    {
      target: environmentConfig.appControllerAddress,
      value: 0n,
      callData: createData,
    },
    {
      target: environmentConfig.permissionControllerAddress as Address,
      value: 0n,
      callData: acceptAdminData,
    },
  ];

  // 5. Add public logs permission if requested
  if (publicLogs) {
    const anyoneCanViewLogsData = encodeFunctionData({
      abi: PermissionControllerABI,
      functionName: "setAppointee",
      args: [
        appId,
        "0x493219d9949348178af1f58740655951a8cd110c" as Address, // AnyoneCanCallAddress
        "0x57ee1fb74c1087e26446abc4fb87fd8f07c43d8d" as Address, // ApiPermissionsTarget
        "0x2fd3f2fe" as Hex, // CanViewAppLogsPermission
      ],
    });
    executions.push({
      target: environmentConfig.permissionControllerAddress as Address,
      value: 0n,
      callData: anyoneCanViewLogsData,
    });
  }

  return {
    appId,
    salt,
    executions,
    walletClient,
    publicClient,
    environmentConfig,
    useWalletClient,
  };
}

/**
 * Execute a prepared deploy batch
 */
export async function executeDeployBatch(
  data: PreparedDeployData,
  context: {
    walletClient: WalletClient;
    publicClient: PublicClient;
    environmentConfig: EnvironmentConfig;
  },
  gas: GasEstimate | undefined,
  logger: Logger,
): Promise<{ appId: Address; txHash: Hex }> {
  const pendingMessage = "Deploying new app...";

  const txHash = await executeBatch(
    {
      walletClient: context.walletClient,
      publicClient: context.publicClient,
      environmentConfig: context.environmentConfig,
      executions: data.executions,
      pendingMessage,
      gas,
    },
    logger,
  );

  return { appId: data.appId, txHash };
}

/**
 * Deploy app on-chain (convenience wrapper that prepares and executes)
 */
export async function deployApp(
  options: DeployAppOptions,
  logger: Logger,
): Promise<{ appId: Address; txHash: Hex }> {
  const prepared = await prepareDeployBatch(options, logger);

  // Extract data and context from prepared batch
  const data: PreparedDeployData = {
    appId: prepared.appId,
    salt: prepared.salt,
    executions: prepared.executions,
  };
  const context = {
    walletClient: prepared.walletClient,
    publicClient: prepared.publicClient,
    environmentConfig: prepared.environmentConfig,
  };

  return executeDeployBatch(data, context, options.gas, logger);
}

/**
 * Upgrade app options - supports both private key and wallet client modes
 */
export type UpgradeAppOptions = (PrivateKeyMode | WalletClientModeOptions) & {
  appID: Address;
  release: Release;
  publicLogs: boolean;
  needsPermissionChange: boolean;
  imageRef: string;
};

/**
 * Options for preparing an upgrade batch
 */
export type PrepareUpgradeBatchOptions = (PrivateKeyMode | WalletClientModeOptions) & {
  appID: Address;
  release: Release;
  publicLogs: boolean;
  needsPermissionChange: boolean;
  imageRef: string;
};

/**
 * Prepare upgrade batch - creates executions without sending transaction
 *
 * Use this to get the prepared batch for gas estimation before executing.
 */
/**
 * Upgrade app on-chain
 *
 * Supports two modes:
 * - Private key mode: Pass { privateKey, rpcUrl, environmentConfig, ... }
 * - Wallet client mode: Pass { walletClient, publicClient, environmentConfig, ... }
 */
export async function prepareUpgradeBatch(
  options: PrepareUpgradeBatchOptions,
): Promise<PreparedUpgradeBatch> {
  const { environmentConfig, appID, release, publicLogs, needsPermissionChange } = options;

  const { walletClient, publicClient, useWalletClient } = resolveClients(options);

  // 1. Pack upgrade app call
  // Convert Release Uint8Array values to hex strings for viem
  const releaseForViem = {
    rmsRelease: {
      artifacts: release.rmsRelease.artifacts.map((artifact) => ({
        digest: `0x${bytesToHex(artifact.digest).slice(2).padStart(64, "0")}` as Hex,
        registry: artifact.registry,
      })),
      upgradeByTime: release.rmsRelease.upgradeByTime,
    },
    publicEnv: bytesToHex(release.publicEnv) as Hex,
    encryptedEnv: bytesToHex(release.encryptedEnv) as Hex,
  };

  const upgradeData = encodeFunctionData({
    abi: AppControllerABI,
    functionName: "upgradeApp",
    args: [appID, releaseForViem],
  });

  // 2. Start with upgrade execution
  const executions: Array<{
    target: Address;
    value: bigint;
    callData: Hex;
  }> = [
    {
      target: environmentConfig.appControllerAddress,
      value: 0n,
      callData: upgradeData,
    },
  ];

  // 3. Add permission transaction if needed
  if (needsPermissionChange) {
    if (publicLogs) {
      // Add public permission (private→public)
      const addLogsData = encodeFunctionData({
        abi: PermissionControllerABI,
        functionName: "setAppointee",
        args: [
          appID,
          "0x493219d9949348178af1f58740655951a8cd110c" as Address, // AnyoneCanCallAddress
          "0x57ee1fb74c1087e26446abc4fb87fd8f07c43d8d" as Address, // ApiPermissionsTarget
          "0x2fd3f2fe" as Hex, // CanViewAppLogsPermission
        ],
      });
      executions.push({
        target: environmentConfig.permissionControllerAddress as Address,
        value: 0n,
        callData: addLogsData,
      });
    } else {
      // Remove public permission (public→private)
      const removeLogsData = encodeFunctionData({
        abi: PermissionControllerABI,
        functionName: "removeAppointee",
        args: [
          appID,
          "0x493219d9949348178af1f58740655951a8cd110c" as Address, // AnyoneCanCallAddress
          "0x57ee1fb74c1087e26446abc4fb87fd8f07c43d8d" as Address, // ApiPermissionsTarget
          "0x2fd3f2fe" as Hex, // CanViewAppLogsPermission
        ],
      });
      executions.push({
        target: environmentConfig.permissionControllerAddress as Address,
        value: 0n,
        callData: removeLogsData,
      });
    }
  }

  return {
    appId: appID,
    executions,
    walletClient,
    publicClient,
    environmentConfig,
    useWalletClient,
  };
}

/**
 * Execute a prepared upgrade batch
 */
export async function executeUpgradeBatch(
  data: PreparedUpgradeData,
  context: {
    walletClient: WalletClient;
    publicClient: PublicClient;
    environmentConfig: EnvironmentConfig;
  },
  gas: GasEstimate | undefined,
  logger: Logger,
): Promise<Hex> {
  const pendingMessage = `Upgrading app ${data.appId}...`;

  const txHash = await executeBatch(
    {
      walletClient: context.walletClient,
      publicClient: context.publicClient,
      environmentConfig: context.environmentConfig,
      executions: data.executions,
      pendingMessage,
      gas,
    },
    logger,
  );

  return txHash;
}

/**
 * Upgrade app on-chain (convenience wrapper that prepares and executes)
 */
export async function upgradeApp(options: UpgradeAppOptions, logger: Logger): Promise<Hex> {
  const prepared = await prepareUpgradeBatch(options);

  // Extract data and context from prepared batch
  const data: PreparedUpgradeData = {
    appId: prepared.appId,
    executions: prepared.executions,
  };
  const context = {
    walletClient: prepared.walletClient,
    publicClient: prepared.publicClient,
    environmentConfig: prepared.environmentConfig,
  };

  return executeUpgradeBatch(data, context, options.gas, logger);
}

/**
 * Send and wait for transaction with confirmation support
 * Supports both private key and wallet client modes
 */
export type SendTransactionOptions = (PrivateKeyMode | WalletClientModeOptions) & {
  to: Address;
  data: Hex;
  value?: bigint;
  pendingMessage: string;
  txDescription: string;
};

export async function sendAndWaitForTransaction(
  options: SendTransactionOptions,
  logger: Logger,
): Promise<Hex> {
  const { to, data, value = 0n, pendingMessage, txDescription, gas } = options;

  // Resolve clients based on mode
  const { walletClient, publicClient, chain } = resolveClients(options);

  const account = walletClient.account;
  if (!account) {
    throw new Error("Wallet client must have an account");
  }

  // Show pending message if provided
  if (pendingMessage) {
    logger.info(`\n${pendingMessage}`);
  }

  // Send transaction with optional gas params
  const hash = await walletClient.sendTransaction({
    account,
    to,
    data,
    value,
    ...(gas?.maxFeePerGas && { maxFeePerGas: gas.maxFeePerGas }),
    ...(gas?.maxPriorityFeePerGas && {
      maxPriorityFeePerGas: gas.maxPriorityFeePerGas,
    }),
    chain,
  });

  logger.info(`Transaction sent: ${hash}`);

  // Wait for receipt
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status === "reverted") {
    let revertReason = "Unknown reason";
    try {
      await publicClient.call({
        to,
        data,
        account: account.address,
      });
    } catch (callError: any) {
      if (callError.data) {
        try {
          const decoded = decodeErrorResult({
            abi: AppControllerABI,
            data: callError.data,
          });
          const formattedError = formatAppControllerError(decoded);
          revertReason = formattedError.message;
        } catch {
          revertReason = callError.message || "Unknown reason";
        }
      } else {
        revertReason = callError.message || "Unknown reason";
      }
    }
    logger.error(`${txDescription} transaction (hash: ${hash}) reverted: ${revertReason}`);
    throw new Error(`${txDescription} transaction (hash: ${hash}) reverted: ${revertReason}`);
  }

  return hash;
}

/**
 * Format AppController errors to user-friendly messages
 */
function formatAppControllerError(decoded: {
  errorName: string;
  args?: readonly unknown[];
}): Error {
  const errorName = decoded.errorName;

  switch (errorName) {
    case "MaxActiveAppsExceeded":
      return new Error(
        "you have reached your app deployment limit. To request access or increase your limit, please visit https://onboarding.eigencloud.xyz/ or reach out to the Eigen team",
      );
    case "GlobalMaxActiveAppsExceeded":
      return new Error(
        "the platform has reached the maximum number of active apps. please try again later",
      );
    case "InvalidPermissions":
      return new Error("you don't have permission to perform this operation");
    case "AppAlreadyExists":
      return new Error("an app with this owner and salt already exists");
    case "AppDoesNotExist":
      return new Error("the specified app does not exist");
    case "InvalidAppStatus":
      return new Error("the app is in an invalid state for this operation");
    case "MoreThanOneArtifact":
      return new Error("only one artifact is allowed per release");
    case "InvalidSignature":
      return new Error("invalid signature provided");
    case "SignatureExpired":
      return new Error("the provided signature has expired");
    case "InvalidReleaseMetadataURI":
      return new Error("invalid release metadata URI provided");
    case "InvalidShortString":
      return new Error("invalid short string format");
    default:
      return new Error(`contract error: ${errorName}`);
  }
}

/**
 * Get active app count for a user
 */
export async function getActiveAppCount(
  rpcUrl: string,
  environmentConfig: EnvironmentConfig,
  user: Address,
): Promise<number> {
  const chain = getChainFromID(environmentConfig.chainID);

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  const count = await publicClient.readContract({
    address: environmentConfig.appControllerAddress,
    abi: AppControllerABI,
    functionName: "getActiveAppCount",
    args: [user],
  });

  return Number(count);
}

/**
 * Get max active apps per user (quota limit)
 */
export async function getMaxActiveAppsPerUser(
  rpcUrl: string,
  environmentConfig: EnvironmentConfig,
  user: Address,
): Promise<number> {
  const chain = getChainFromID(environmentConfig.chainID);

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  const quota = await publicClient.readContract({
    address: environmentConfig.appControllerAddress,
    abi: AppControllerABI,
    functionName: "getMaxActiveAppsPerUser",
    args: [user],
  });

  return Number(quota);
}

/**
 * Get apps by creator (paginated)
 */
export interface AppConfig {
  release: any; // Release struct from contract
  status: number; // AppStatus enum
}

export async function getAppsByCreator(
  rpcUrl: string,
  environmentConfig: EnvironmentConfig,
  creator: Address,
  offset: bigint,
  limit: bigint,
): Promise<{ apps: Address[]; appConfigs: AppConfig[] }> {
  const chain = getChainFromID(environmentConfig.chainID);

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  const result = (await publicClient.readContract({
    address: environmentConfig.appControllerAddress,
    abi: AppControllerABI,
    functionName: "getAppsByCreator",
    args: [creator, offset, limit],
  })) as [Address[], AppConfig[]];

  // Result is a tuple: [Address[], AppConfig[]]
  return {
    apps: result[0],
    appConfigs: result[1],
  };
}

/**
 * Get apps by developer
 */
export async function getAppsByDeveloper(
  rpcUrl: string,
  environmentConfig: EnvironmentConfig,
  developer: Address,
  offset: bigint,
  limit: bigint,
): Promise<{ apps: Address[]; appConfigs: AppConfig[] }> {
  const chain = getChainFromID(environmentConfig.chainID);

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  const result = (await publicClient.readContract({
    address: environmentConfig.appControllerAddress,
    abi: AppControllerABI,
    functionName: "getAppsByDeveloper",
    args: [developer, offset, limit],
  })) as [Address[], AppConfig[]];

  // Result is a tuple: [Address[], AppConfig[]]
  return {
    apps: result[0],
    appConfigs: result[1],
  };
}

/**
 * Fetch all apps by a developer by auto-pagination
 */
export async function getAllAppsByDeveloper(
  rpcUrl: string,
  env: EnvironmentConfig,
  developer: Address,
  pageSize: bigint = 100n,
): Promise<{ apps: Address[]; appConfigs: AppConfig[] }> {
  let offset = 0n;
  const allApps: Address[] = [];
  const allConfigs: AppConfig[] = [];

  while (true) {
    const { apps, appConfigs } = await getAppsByDeveloper(rpcUrl, env, developer, offset, pageSize);

    if (apps.length === 0) break;

    allApps.push(...apps);
    allConfigs.push(...appConfigs);

    if (apps.length < Number(pageSize)) break;

    offset += pageSize;
  }

  return {
    apps: allApps,
    appConfigs: allConfigs,
  };
}

/**
 * Get latest release block numbers for multiple apps
 */
export async function getAppLatestReleaseBlockNumbers(
  rpcUrl: string,
  environmentConfig: EnvironmentConfig,
  appIDs: Address[],
): Promise<Map<Address, number>> {
  const chain = getChainFromID(environmentConfig.chainID);

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  // Fetch block numbers in parallel
  const results = await Promise.all(
    appIDs.map((appID) =>
      publicClient
        .readContract({
          address: environmentConfig.appControllerAddress,
          abi: AppControllerABI,
          functionName: "getAppLatestReleaseBlockNumber",
          args: [appID],
        })
        .catch(() => null),
    ),
  );

  const blockNumbers = new Map<Address, number>();
  for (let i = 0; i < appIDs.length; i++) {
    const result = results[i];
    if (result !== null && result !== undefined) {
      blockNumbers.set(appIDs[i], Number(result));
    }
  }

  return blockNumbers;
}

/**
 * Get block timestamps for multiple block numbers
 */
export async function getBlockTimestamps(
  rpcUrl: string,
  environmentConfig: EnvironmentConfig,
  blockNumbers: number[],
): Promise<Map<number, number>> {
  const chain = getChainFromID(environmentConfig.chainID);

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  // Deduplicate block numbers
  const uniqueBlockNumbers = [...new Set(blockNumbers)].filter((n) => n > 0);

  const timestamps = new Map<number, number>();

  // Fetch blocks in parallel
  const blocks = await Promise.all(
    uniqueBlockNumbers.map((blockNumber) =>
      publicClient.getBlock({ blockNumber: BigInt(blockNumber) }).catch(() => null),
    ),
  );

  for (let i = 0; i < uniqueBlockNumbers.length; i++) {
    const block = blocks[i];
    if (block) {
      timestamps.set(uniqueBlockNumbers[i], Number(block.timestamp));
    }
  }

  return timestamps;
}

/**
 * Suspend apps for an account
 * Suspend options - supports both private key and wallet client modes
 */
export type SuspendOptions = (PrivateKeyMode | WalletClientModeOptions) & {
  account: Address;
  apps: Address[];
};

/**
 * Suspend apps for an account
 *
 * Supports two modes:
 * - Private key mode: Pass { privateKey, rpcUrl, environmentConfig, ... }
 * - Wallet client mode: Pass { walletClient, publicClient, environmentConfig, ... }
 */
export async function suspend(options: SuspendOptions, logger: Logger): Promise<Hex | false> {
  const { environmentConfig, account, apps } = options;

  const suspendData = encodeFunctionData({
    abi: AppControllerABI,
    functionName: "suspend",
    args: [account, apps],
  });

  const pendingMessage = `Suspending ${apps.length} app(s)...`;
  // Build sendAndWaitForTransaction options based on mode
  const sendOptions: SendTransactionOptions =
    "walletClient" in options && options.walletClient
      ? {
          walletClient: options.walletClient,
          publicClient: options.publicClient,
          environmentConfig,
          to: environmentConfig.appControllerAddress as Address,
          data: suspendData,
          pendingMessage,
          txDescription: "Suspend",
        }
      : {
          privateKey: (options as PrivateKeyMode).privateKey,
          rpcUrl: (options as PrivateKeyMode).rpcUrl,
          environmentConfig,
          to: environmentConfig.appControllerAddress as Address,
          data: suspendData,
          pendingMessage,
          txDescription: "Suspend",
        };

  return sendAndWaitForTransaction(sendOptions, logger);
}

/**
 * Check if account is delegated to the ERC-7702 delegator
 */
export async function isDelegated(options: {
  privateKey: string;
  rpcUrl: string;
  environmentConfig: EnvironmentConfig;
}): Promise<boolean> {
  // const { privateKey, rpcUrl, environmentConfig } = options;
  const { walletClient, publicClient } = resolveClients(options);

  const account = walletClient.account;
  if (!account) {
    throw new Error("Wallet client must have an account");
  }

  return checkERC7702Delegation(
    publicClient,
    account.address,
    options.environmentConfig.erc7702DelegatorAddress as Address,
  );
}

/**
 * Undelegate options - supports both private key and wallet client modes
 */
export type UndelegateOptions = PrivateKeyMode | WalletClientModeOptions;

/**
 * Undelegate account (removes EIP-7702 delegation)
 *
 * Supports two modes:
 * - Private key mode: Pass { privateKey, rpcUrl, environmentConfig }
 * - Wallet client mode: Pass { walletClient, publicClient, environmentConfig }
 */
export async function undelegate(options: UndelegateOptions, logger: Logger): Promise<Hex> {
  // Resolve clients based on mode
  const { walletClient, publicClient, chain } = resolveClients(options);

  const account = walletClient.account;
  if (!account) {
    throw new Error("Wallet client must have an account");
  }

  // Create authorization to undelegate (empty address = undelegate)
  const transactionNonce = await publicClient.getTransactionCount({
    address: account.address,
    blockTag: "pending",
  });

  const chainId = await publicClient.getChainId();
  const authorizationNonce = BigInt(transactionNonce) + 1n;

  logger.debug("Using wallet client signing for undelegate authorization");

  const signedAuthorization = await walletClient.signAuthorization({
    contractAddress: "0x0000000000000000000000000000000000000000" as Address,
    chainId: chainId,
    nonce: Number(authorizationNonce),
    account: account,
  });

  const authorizationList = [signedAuthorization];

  // Send transaction with authorization list
  const hash = await walletClient.sendTransaction({
    account,
    to: account.address, // Send to self
    data: "0x" as Hex, // Empty data
    value: 0n,
    authorizationList,
    chain,
  });

  logger.info(`Transaction sent: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status === "reverted") {
    logger.error(`Undelegate transaction (hash: ${hash}) reverted`);
    throw new Error(`Undelegate transaction (hash: ${hash}) reverted`);
  }

  return hash;
}
