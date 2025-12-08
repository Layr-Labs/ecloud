/**
 * Contract interactions
 *
 * This module handles on-chain contract interactions using viem
 */

import { privateKeyToAccount } from "viem/accounts";
import { executeBatch } from "./eip7702";
import {
  createWalletClient,
  createPublicClient,
  http,
  Address,
  Hex,
  encodeFunctionData,
  decodeErrorResult,
} from "viem";
import type { WalletClient, PublicClient } from "viem";
import { hashAuthorization } from "viem/utils";
import { sign } from "viem/accounts";

import { addHexPrefix, getChainFromID } from "../utils";

import { EnvironmentConfig, Logger } from "../types";
import { Release } from "../types";
import { getAppName } from "../registry/appNames";

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

export interface DeployAppOptions {
  privateKey: string; // Will be converted to Hex
  rpcUrl: string;
  environmentConfig: EnvironmentConfig;
  salt: Uint8Array;
  release: Release;
  publicLogs: boolean;
  imageRef: string;
  /** Optional gas params from estimation */
  gas?: {
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
  };
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
  /** Private key in hex format */
  privateKeyHex: Hex;
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
  /** Private key in hex format */
  privateKeyHex: Hex;
}

/**
 * Calculate app ID from owner address and salt
 */
export async function calculateAppID(
  privateKey: string | Hex,
  rpcUrl: string,
  environmentConfig: EnvironmentConfig,
  salt: Uint8Array,
): Promise<Address> {
  const privateKeyHex = addHexPrefix(privateKey);
  const account = privateKeyToAccount(privateKeyHex);

  const chain = getChainFromID(environmentConfig.chainID);

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  // Ensure salt is properly formatted as hex string (32 bytes = 64 hex chars)
  const saltHexString = Buffer.from(salt).toString("hex");
  // Pad to 64 characters if needed
  const paddedSaltHex = saltHexString.padStart(64, "0");
  const saltHex = `0x${paddedSaltHex}` as Hex;

  // Ensure address is a string (viem might return Hex type)
  const accountAddress =
    typeof account.address === "string" ? account.address : (account.address as Buffer).toString();

  const appID = await publicClient.readContract({
    address: environmentConfig.appControllerAddress as Address,
    abi: AppControllerABI,
    functionName: "calculateAppId",
    args: [accountAddress as Address, saltHex],
  });

  return appID as Address;
}

/**
 * Options for preparing a deploy batch
 */
export interface PrepareDeployBatchOptions {
  privateKey: string;
  rpcUrl: string;
  environmentConfig: EnvironmentConfig;
  salt: Uint8Array;
  release: Release;
  publicLogs: boolean;
}

/**
 * Prepare deploy batch - creates executions without sending transaction
 *
 * Use this to get the prepared batch for gas estimation before executing.
 */
export async function prepareDeployBatch(
  options: PrepareDeployBatchOptions,
  logger: Logger,
): Promise<PreparedDeployBatch> {
  const { privateKey, rpcUrl, environmentConfig, salt, release, publicLogs } = options;

  const privateKeyHex = addHexPrefix(privateKey) as Hex;
  const account = privateKeyToAccount(privateKeyHex);

  const chain = getChainFromID(environmentConfig.chainID);

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

  // 1. Calculate app ID
  logger.info("Calculating app ID...");
  const appId = await calculateAppID(privateKeyHex, rpcUrl, environmentConfig, salt);
  logger.info(`App ID: ${appId}`);

  // Verify the app ID calculation matches what createApp will deploy
  logger.debug(`App ID calculated: ${appId}`);
  logger.debug(`This address will be used for acceptAdmin call`);

  // 2. Pack create app call
  const saltHexString = Buffer.from(salt).toString("hex");
  const paddedSaltHex = saltHexString.padStart(64, "0");
  const saltHex = `0x${paddedSaltHex}` as Hex;

  // Convert Release Uint8Array values to hex strings for viem
  const releaseForViem = {
    rmsRelease: {
      artifacts: release.rmsRelease.artifacts.map((artifact) => ({
        digest: `0x${Buffer.from(artifact.digest).toString("hex").padStart(64, "0")}` as Hex,
        registry: artifact.registry,
      })),
      upgradeByTime: release.rmsRelease.upgradeByTime,
    },
    publicEnv: `0x${Buffer.from(release.publicEnv).toString("hex")}` as Hex,
    encryptedEnv: `0x${Buffer.from(release.encryptedEnv).toString("hex")}` as Hex,
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
      target: environmentConfig.appControllerAddress as Address,
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
    privateKeyHex,
  };
}

/**
 * Execute a prepared deploy batch
 */
export async function executeDeployBatch(
  prepared: PreparedDeployBatch,
  gas: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } | undefined,
  logger: Logger,
): Promise<{ appId: Address; txHash: Hex }> {
  const pendingMessage = "Deploying new app...";

  const txHash = await executeBatch(
    {
      walletClient: prepared.walletClient,
      publicClient: prepared.publicClient,
      environmentConfig: prepared.environmentConfig,
      executions: prepared.executions,
      pendingMessage,
      privateKey: prepared.privateKeyHex,
      gas,
    },
    logger,
  );

  return { appId: prepared.appId, txHash };
}

/**
 * Deploy app on-chain (convenience wrapper that prepares and executes)
 */
export async function deployApp(
  options: DeployAppOptions,
  logger: Logger,
): Promise<{ appId: Address; txHash: Hex }> {
  const prepared = await prepareDeployBatch(
    {
      privateKey: options.privateKey,
      rpcUrl: options.rpcUrl,
      environmentConfig: options.environmentConfig,
      salt: options.salt,
      release: options.release,
      publicLogs: options.publicLogs,
    },
    logger,
  );

  return executeDeployBatch(prepared, options.gas, logger);
}

export interface UpgradeAppOptions {
  privateKey: string; // Will be converted to Hex
  rpcUrl: string;
  environmentConfig: EnvironmentConfig;
  appId: Address;
  release: Release;
  publicLogs: boolean;
  needsPermissionChange: boolean;
  imageRef: string;
  /** Optional gas params from estimation */
  gas?: {
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
  };
}

/**
 * Options for preparing an upgrade batch
 */
export interface PrepareUpgradeBatchOptions {
  privateKey: string;
  rpcUrl: string;
  environmentConfig: EnvironmentConfig;
  appId: Address;
  release: Release;
  publicLogs: boolean;
  needsPermissionChange: boolean;
}

/**
 * Prepare upgrade batch - creates executions without sending transaction
 *
 * Use this to get the prepared batch for gas estimation before executing.
 */
export async function prepareUpgradeBatch(
  options: PrepareUpgradeBatchOptions,
): Promise<PreparedUpgradeBatch> {
  const {
    privateKey,
    rpcUrl,
    environmentConfig,
    appId,
    release,
    publicLogs,
    needsPermissionChange,
  } = options;

  const privateKeyHex = addHexPrefix(privateKey) as Hex;
  const account = privateKeyToAccount(privateKeyHex);

  const chain = getChainFromID(environmentConfig.chainID);

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

  // 1. Pack upgrade app call
  // Convert Release Uint8Array values to hex strings for viem
  const releaseForViem = {
    rmsRelease: {
      artifacts: release.rmsRelease.artifacts.map((artifact) => ({
        digest: `0x${Buffer.from(artifact.digest).toString("hex").padStart(64, "0")}` as Hex,
        registry: artifact.registry,
      })),
      upgradeByTime: release.rmsRelease.upgradeByTime,
    },
    publicEnv: `0x${Buffer.from(release.publicEnv).toString("hex")}` as Hex,
    encryptedEnv: `0x${Buffer.from(release.encryptedEnv).toString("hex")}` as Hex,
  };

  const upgradeData = encodeFunctionData({
    abi: AppControllerABI,
    functionName: "upgradeApp",
    args: [appId, releaseForViem],
  });

  // 2. Start with upgrade execution
  const executions: Array<{
    target: Address;
    value: bigint;
    callData: Hex;
  }> = [
    {
      target: environmentConfig.appControllerAddress as Address,
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
          appId,
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
          appId,
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
    appId,
    executions,
    walletClient,
    publicClient,
    environmentConfig,
    privateKeyHex,
  };
}

/**
 * Execute a prepared upgrade batch
 */
export async function executeUpgradeBatch(
  prepared: PreparedUpgradeBatch,
  gas: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } | undefined,
  logger: Logger,
): Promise<Hex> {
  const appName = getAppName(prepared.environmentConfig.name, prepared.appId);
  let pendingMessage = "Upgrading app...";
  if (appName !== "") {
    pendingMessage = `Upgrading app '${appName}'...`;
  }

  const txHash = await executeBatch(
    {
      walletClient: prepared.walletClient,
      publicClient: prepared.publicClient,
      environmentConfig: prepared.environmentConfig,
      executions: prepared.executions,
      pendingMessage,
      privateKey: prepared.privateKeyHex,
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
  const prepared = await prepareUpgradeBatch({
    privateKey: options.privateKey,
    rpcUrl: options.rpcUrl,
    environmentConfig: options.environmentConfig,
    appId: options.appId,
    release: options.release,
    publicLogs: options.publicLogs,
    needsPermissionChange: options.needsPermissionChange,
  });

  return executeUpgradeBatch(prepared, options.gas, logger);
}

/**
 * Send and wait for transaction with confirmation support
 */
export interface SendTransactionOptions {
  privateKey: string;
  rpcUrl: string;
  environmentConfig: EnvironmentConfig;
  to: Address;
  data: Hex;
  value?: bigint;
  pendingMessage: string;
  txDescription: string;
  /** Optional gas params from estimation */
  gas?: {
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
  };
}

export async function sendAndWaitForTransaction(
  options: SendTransactionOptions,
  logger: Logger,
): Promise<Hex> {
  const {
    privateKey,
    rpcUrl,
    environmentConfig,
    to,
    data,
    value = 0n,
    pendingMessage,
    txDescription,
    gas,
  } = options;

  const privateKeyHex = addHexPrefix(privateKey) as Hex;
  const account = privateKeyToAccount(privateKeyHex);

  const chain = getChainFromID(environmentConfig.chainID);

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

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
    ...(gas?.maxPriorityFeePerGas && { maxPriorityFeePerGas: gas.maxPriorityFeePerGas }),
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
    address: environmentConfig.appControllerAddress as Address,
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
    address: environmentConfig.appControllerAddress as Address,
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
    address: environmentConfig.appControllerAddress as Address,
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
    address: environmentConfig.appControllerAddress as Address,
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
 * Suspend apps for an account
 */
export async function suspend(
  options: {
    privateKey: string;
    rpcUrl: string;
    environmentConfig: EnvironmentConfig;
    account: Address;
    apps: Address[];
  },
  logger: Logger,
): Promise<Hex | false> {
  const { privateKey, rpcUrl, environmentConfig, account, apps } = options;

  const suspendData = encodeFunctionData({
    abi: AppControllerABI,
    functionName: "suspend",
    args: [account, apps],
  });

  const pendingMessage = `Suspending ${apps.length} app(s)...`;

  return sendAndWaitForTransaction(
    {
      privateKey,
      rpcUrl,
      environmentConfig,
      to: environmentConfig.appControllerAddress as Address,
      data: suspendData,
      pendingMessage,
      txDescription: "Suspend",
    },
    logger,
  );
}

/**
 * Undelegate account (removes EIP-7702 delegation)
 */
export async function undelegate(
  options: {
    privateKey: string;
    rpcUrl: string;
    environmentConfig: EnvironmentConfig;
  },
  logger: Logger,
): Promise<Hex> {
  const { privateKey, rpcUrl, environmentConfig } = options;

  const privateKeyHex = addHexPrefix(privateKey);
  const account = privateKeyToAccount(privateKeyHex);

  const chain = getChainFromID(environmentConfig.chainID);

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

  // Create authorization to undelegate (empty address = undelegate)
  const transactionNonce = await publicClient.getTransactionCount({
    address: account.address,
    blockTag: "pending",
  });

  const chainId = await publicClient.getChainId();
  const authorizationNonce = BigInt(transactionNonce) + 1n;

  const authorization = {
    chainId: Number(chainId),
    address: "0x0000000000000000000000000000000000000000" as Address, // Empty address = undelegate
    nonce: authorizationNonce,
  };

  const sighash = hashAuthorization({
    chainId: authorization.chainId,
    contractAddress: authorization.address,
    nonce: Number(authorization.nonce),
  });

  const sig = await sign({
    hash: sighash,
    privateKey: privateKeyHex,
  });

  const v = Number(sig.v);
  const yParity = v === 27 ? 0 : 1;

  const authorizationList = [
    {
      chainId: authorization.chainId,
      address: authorization.address,
      nonce: Number(authorization.nonce),
      r: sig.r as Hex,
      s: sig.s as Hex,
      yParity,
    },
  ];

  // Send transaction with authorization list
  const hash = await walletClient.sendTransaction({
    account,
    to: account.address, // Send to self
    data: "0x" as Hex, // Empty data
    value: 0n,
    authorizationList,
  });

  logger.info(`Transaction sent: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status === "reverted") {
    logger.error(`Undelegate transaction (hash: ${hash}) reverted`);
    throw new Error(`Undelegate transaction (hash: ${hash}) reverted`);
  }

  return hash;
}
