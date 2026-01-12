/**
 * Contract interactions
 *
 * This module handles on-chain contract interactions using viem.
 *
 * Accepts viem's WalletClient and PublicClient directly, which abstract over both
 * local accounts (privateKeyToAccount) and external signers (MetaMask, etc.).
 *
 * @example
 * // CLI usage with private key
 * const { walletClient, publicClient } = createClients({ privateKey, rpcUrl, chainId });
 * await deployApp({ walletClient, publicClient, environmentConfig, ... }, logger);
 *
 * @example
 * // Browser usage with external wallet
 * const walletClient = createWalletClient({ chain, transport: custom(window.ethereum!) });
 * const publicClient = createPublicClient({ chain, transport: custom(window.ethereum!) });
 * await deployApp({ walletClient, publicClient, environmentConfig, ... }, logger);
 */

import { executeBatch, checkERC7702Delegation } from "./eip7702";
import { Address, Hex, encodeFunctionData, decodeErrorResult, bytesToHex } from "viem";
import type { WalletClient, PublicClient } from "viem";

import {
  EnvironmentConfig,
  Logger,
  PreparedDeployData,
  PreparedUpgradeData,
  noopLogger,
  DeployProgressCallback,
  SequentialDeployResult,
  DeployStep,
} from "../types";
import { Release } from "../types";
import { getChainFromID } from "../utils/helpers";

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
  publicClient: PublicClient;
  from: Address;
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
  const { publicClient, from, to, data, value = 0n } = options;

  // Get current gas prices
  const fees = await publicClient.estimateFeesPerGas();

  // Estimate gas for the transaction
  const gasLimit = await publicClient.estimateGas({
    account: from,
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
 * Deploy app options
 */
export interface DeployAppOptions {
  walletClient: WalletClient;
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  salt: Uint8Array;
  release: Release;
  publicLogs: boolean;
  imageRef: string;
  gas?: GasEstimate;
}

/**
 * Options for calculateAppID
 */
export interface CalculateAppIDOptions {
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  ownerAddress: Address;
  salt: Uint8Array;
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
}

/**
 * Calculate app ID from owner address and salt
 */
export async function calculateAppID(options: CalculateAppIDOptions): Promise<Address> {
  const { publicClient, environmentConfig, ownerAddress, salt } = options;

  // Ensure salt is properly formatted as hex string (32 bytes = 64 hex chars)
  // bytesToHex returns 0x-prefixed string, slice(2) removes the prefix for padding
  const saltHexString = bytesToHex(salt).slice(2);
  // Pad to 64 characters if needed
  const paddedSaltHex = saltHexString.padStart(64, "0");
  const saltHex = `0x${paddedSaltHex}` as Hex;

  const appID = await publicClient.readContract({
    address: environmentConfig.appControllerAddress as Address,
    abi: AppControllerABI,
    functionName: "calculateAppId",
    args: [ownerAddress, saltHex],
  });

  return appID as Address;
}

/**
 * Options for preparing a deploy batch
 */
export interface PrepareDeployBatchOptions {
  walletClient: WalletClient;
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  salt: Uint8Array;
  release: Release;
  publicLogs: boolean;
  imageRef: string;
}

/**
 * Prepare deploy batch - creates executions without sending transaction
 *
 * Use this to get the prepared batch for gas estimation before executing.
 */
export async function prepareDeployBatch(
  options: PrepareDeployBatchOptions,
  logger: Logger = noopLogger,
): Promise<PreparedDeployBatch> {
  const { walletClient, publicClient, environmentConfig, salt, release, publicLogs } = options;

  const account = walletClient.account;
  if (!account) {
    throw new Error("WalletClient must have an account attached");
  }

  // 1. Calculate app ID
  logger.info("Calculating app ID...");
  const appId = await calculateAppID({
    publicClient,
    environmentConfig,
    ownerAddress: account.address,
    salt,
  });

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
  gas?: GasEstimate,
  logger: Logger = noopLogger,
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
  logger: Logger = noopLogger,
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
 * Check if wallet account supports EIP-7702 signing
 *
 * Local accounts (from privateKeyToAccount) support signAuthorization.
 * JSON-RPC accounts (browser wallets like MetaMask) do not.
 */
export function supportsEIP7702(walletClient: WalletClient): boolean {
  const account = walletClient.account;
  if (!account) return false;

  // Local accounts have type "local", JSON-RPC accounts have type "json-rpc"
  // Only local accounts support signAuthorization
  return account.type === "local";
}

/**
 * Options for sequential deployment (non-EIP-7702)
 */
export interface ExecuteDeploySequentialOptions {
  walletClient: WalletClient;
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  /** Prepared deployment data from prepareDeployBatch */
  data: PreparedDeployData;
  /** Whether to set public logs permission */
  publicLogs: boolean;
  /** Optional callback for progress updates */
  onProgress?: DeployProgressCallback;
}

/**
 * Execute deployment as sequential transactions (non-EIP-7702 fallback)
 *
 * Use this for browser wallets (JSON-RPC accounts) that don't support signAuthorization.
 * This requires 2-3 wallet signatures instead of 1, but works with all wallet types.
 *
 * Steps:
 * 1. createApp - Creates the app on-chain
 * 2. acceptAdmin - Accepts admin role for the app
 * 3. setAppointee (optional) - Sets public logs permission
 */
export async function executeDeploySequential(
  options: ExecuteDeploySequentialOptions,
  logger: Logger = noopLogger,
): Promise<SequentialDeployResult> {
  const { walletClient, publicClient, environmentConfig, data, publicLogs, onProgress } = options;

  const account = walletClient.account;
  if (!account) {
    throw new Error("WalletClient must have an account attached");
  }

  const chain = getChainFromID(environmentConfig.chainID);
  const txHashes: { createApp: Hex; acceptAdmin: Hex; setPublicLogs?: Hex } = {
    createApp: "0x" as Hex,
    acceptAdmin: "0x" as Hex,
  };

  // Step 1: Create App
  logger.info("Step 1/3: Creating app...");
  onProgress?.("createApp");

  const createAppExecution = data.executions[0];
  const createAppHash = await walletClient.sendTransaction({
    account,
    to: createAppExecution.target,
    data: createAppExecution.callData,
    value: createAppExecution.value,
    chain,
  });

  logger.info(`createApp transaction sent: ${createAppHash}`);
  const createAppReceipt = await publicClient.waitForTransactionReceipt({ hash: createAppHash });

  if (createAppReceipt.status === "reverted") {
    throw new Error(`createApp transaction reverted: ${createAppHash}`);
  }

  txHashes.createApp = createAppHash;
  logger.info(`createApp confirmed in block ${createAppReceipt.blockNumber}`);

  // Step 2: Accept Admin
  logger.info("Step 2/3: Accepting admin role...");
  onProgress?.("acceptAdmin", createAppHash);

  const acceptAdminExecution = data.executions[1];
  const acceptAdminHash = await walletClient.sendTransaction({
    account,
    to: acceptAdminExecution.target,
    data: acceptAdminExecution.callData,
    value: acceptAdminExecution.value,
    chain,
  });

  logger.info(`acceptAdmin transaction sent: ${acceptAdminHash}`);
  const acceptAdminReceipt = await publicClient.waitForTransactionReceipt({
    hash: acceptAdminHash,
  });

  if (acceptAdminReceipt.status === "reverted") {
    throw new Error(`acceptAdmin transaction reverted: ${acceptAdminHash}`);
  }

  txHashes.acceptAdmin = acceptAdminHash;
  logger.info(`acceptAdmin confirmed in block ${acceptAdminReceipt.blockNumber}`);

  // Step 3: Set Public Logs (if requested and present in executions)
  if (publicLogs && data.executions.length > 2) {
    logger.info("Step 3/3: Setting public logs permission...");
    onProgress?.("setPublicLogs", acceptAdminHash);

    const setAppointeeExecution = data.executions[2];
    const setAppointeeHash = await walletClient.sendTransaction({
      account,
      to: setAppointeeExecution.target,
      data: setAppointeeExecution.callData,
      value: setAppointeeExecution.value,
      chain,
    });

    logger.info(`setAppointee transaction sent: ${setAppointeeHash}`);
    const setAppointeeReceipt = await publicClient.waitForTransactionReceipt({
      hash: setAppointeeHash,
    });

    if (setAppointeeReceipt.status === "reverted") {
      throw new Error(`setAppointee transaction reverted: ${setAppointeeHash}`);
    }

    txHashes.setPublicLogs = setAppointeeHash;
    logger.info(`setAppointee confirmed in block ${setAppointeeReceipt.blockNumber}`);
  }

  onProgress?.("complete", txHashes.setPublicLogs || txHashes.acceptAdmin);

  logger.info(`Deployment complete! App ID: ${data.appId}`);

  return {
    appId: data.appId,
    txHashes,
  };
}

/**
 * Result from EIP-5792 batched deployment
 */
export interface BatchedDeployResult {
  appId: Address;
  /** Batch ID from sendCalls (can be used with getCallsStatus) */
  batchId: string;
  /** Transaction receipts from the batch */
  receipts: Array<{ transactionHash: Hex }>;
}

/**
 * Options for EIP-5792 batched deployment
 */
export interface ExecuteDeployBatchedOptions {
  walletClient: WalletClient;
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  /** Prepared deployment data from prepareDeployBatch */
  data: PreparedDeployData;
  /** Whether to set public logs permission */
  publicLogs: boolean;
  /** Optional callback for progress updates */
  onProgress?: DeployProgressCallback;
}

/**
 * Check if wallet supports EIP-5792 (sendCalls/wallet_sendCalls)
 *
 * This checks the wallet's capabilities to see if it supports atomic batch calls.
 * MetaMask and other modern wallets are adding support for this standard.
 */
export async function supportsEIP5792(walletClient: WalletClient): Promise<boolean> {
  try {
    // Check if getCapabilities method exists
    if (typeof (walletClient as any).getCapabilities !== "function") {
      return false;
    }

    const account = walletClient.account;
    if (!account) return false;

    // Try to get capabilities - if this works, the wallet supports EIP-5792
    const capabilities = await (walletClient as any).getCapabilities({
      account: account.address,
    });

    // Check if we got any capabilities back
    return (
      capabilities !== null && capabilities !== undefined && Object.keys(capabilities).length > 0
    );
  } catch {
    // If getCapabilities fails, the wallet doesn't support EIP-5792
    return false;
  }
}

/**
 * Execute deployment using EIP-5792 sendCalls (batched wallet calls)
 *
 * This batches all deployment transactions (createApp, acceptAdmin, setPublicLogs)
 * into a single wallet interaction. Better UX than sequential transactions.
 *
 * Use this for browser wallets that support EIP-5792 but not EIP-7702.
 *
 * @returns BatchedDeployResult with appId and batch receipts
 */
export async function executeDeployBatched(
  options: ExecuteDeployBatchedOptions,
  logger: Logger = noopLogger,
): Promise<BatchedDeployResult> {
  const { walletClient, environmentConfig, data, publicLogs, onProgress } = options;

  const account = walletClient.account;
  if (!account) {
    throw new Error("WalletClient must have an account attached");
  }

  const chain = getChainFromID(environmentConfig.chainID);

  // Build calls array for sendCalls
  const calls: Array<{ to: Address; data: Hex; value: bigint }> = data.executions.map(
    (execution) => ({
      to: execution.target,
      data: execution.callData,
      value: execution.value,
    }),
  );

  // If public logs is false but executions include the permission call, filter it out
  // (This shouldn't happen if prepareDeployBatch was called correctly, but be safe)
  const filteredCalls = publicLogs ? calls : calls.slice(0, 2);

  logger.info(`Deploying with EIP-5792 sendCalls (${filteredCalls.length} calls)...`);
  onProgress?.("createApp");

  try {
    // Send all calls in a single batch
    const { id: batchId } = await (walletClient as any).sendCalls({
      account,
      chain,
      calls: filteredCalls,
      forceAtomic: true,
    });

    logger.info(`Batch submitted with ID: ${batchId}`);
    onProgress?.("acceptAdmin");

    // Poll for batch completion using getCallsStatus
    let status: any;
    let attempts = 0;
    const maxAttempts = 120; // 10 minutes max (5s intervals)

    while (attempts < maxAttempts) {
      try {
        status = await (walletClient as any).getCallsStatus({ id: batchId });

        if (status.status === "success" || status.status === "confirmed") {
          logger.info(`Batch confirmed with ${status.receipts?.length || 0} receipts`);
          break;
        }

        if (status.status === "failed" || status.status === "reverted") {
          throw new Error(`Batch transaction failed: ${status.status}`);
        }
      } catch (statusError: any) {
        // Some wallets may not support getCallsStatus, wait and check chain
        if (statusError.message?.includes("not supported")) {
          logger.warn("getCallsStatus not supported, waiting for chain confirmation...");
          // Fall back to waiting a fixed time
          await new Promise((resolve) => setTimeout(resolve, 15000));
          break;
        }
        throw statusError;
      }

      // Wait 5 seconds before next poll
      await new Promise((resolve) => setTimeout(resolve, 5000));
      attempts++;
    }

    if (attempts >= maxAttempts) {
      throw new Error("Timeout waiting for batch confirmation");
    }

    if (publicLogs) {
      onProgress?.("setPublicLogs");
    }
    onProgress?.("complete");

    // Extract transaction hashes from receipts
    const receipts = (status?.receipts || []).map((r: any) => ({
      transactionHash: r.transactionHash || r.hash,
    }));

    logger.info(`Deployment complete! App ID: ${data.appId}`);

    return {
      appId: data.appId,
      batchId,
      receipts,
    };
  } catch (error: any) {
    // Check if the error indicates sendCalls is not supported
    if (
      error.message?.includes("not supported") ||
      error.message?.includes("wallet_sendCalls") ||
      error.code === -32601 // Method not found
    ) {
      throw new Error("EIP5792_NOT_SUPPORTED");
    }
    throw error;
  }
}

/**
 * Upgrade app options
 */
export interface UpgradeAppOptions {
  walletClient: WalletClient;
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  appID: Address;
  release: Release;
  publicLogs: boolean;
  needsPermissionChange: boolean;
  imageRef: string;
  gas?: GasEstimate;
}

/**
 * Options for preparing an upgrade batch
 */
export interface PrepareUpgradeBatchOptions {
  walletClient: WalletClient;
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  appID: Address;
  release: Release;
  publicLogs: boolean;
  needsPermissionChange: boolean;
  imageRef: string;
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
    walletClient,
    publicClient,
    environmentConfig,
    appID,
    release,
    publicLogs,
    needsPermissionChange,
  } = options;

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
  gas?: GasEstimate,
  logger: Logger = noopLogger,
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
export async function upgradeApp(
  options: UpgradeAppOptions,
  logger: Logger = noopLogger,
): Promise<Hex> {
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
 */
export interface SendTransactionOptions {
  walletClient: WalletClient;
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  to: Address;
  data: Hex;
  value?: bigint;
  pendingMessage: string;
  txDescription: string;
  gas?: GasEstimate;
}

export async function sendAndWaitForTransaction(
  options: SendTransactionOptions,
  logger: Logger = noopLogger,
): Promise<Hex> {
  const {
    walletClient,
    publicClient,
    environmentConfig,
    to,
    data,
    value = 0n,
    pendingMessage,
    txDescription,
    gas,
  } = options;

  const account = walletClient.account;
  if (!account) {
    throw new Error("WalletClient must have an account attached");
  }

  const chain = getChainFromID(environmentConfig.chainID);

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
  publicClient: PublicClient,
  environmentConfig: EnvironmentConfig,
  user: Address,
): Promise<number> {
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
  publicClient: PublicClient,
  environmentConfig: EnvironmentConfig,
  user: Address,
): Promise<number> {
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
  publicClient: PublicClient,
  environmentConfig: EnvironmentConfig,
  creator: Address,
  offset: bigint,
  limit: bigint,
): Promise<{ apps: Address[]; appConfigs: AppConfig[] }> {
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
  publicClient: PublicClient,
  environmentConfig: EnvironmentConfig,
  developer: Address,
  offset: bigint,
  limit: bigint,
): Promise<{ apps: Address[]; appConfigs: AppConfig[] }> {
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
  publicClient: PublicClient,
  env: EnvironmentConfig,
  developer: Address,
  pageSize: bigint = 100n,
): Promise<{ apps: Address[]; appConfigs: AppConfig[] }> {
  let offset = 0n;
  const allApps: Address[] = [];
  const allConfigs: AppConfig[] = [];

  while (true) {
    const { apps, appConfigs } = await getAppsByDeveloper(
      publicClient,
      env,
      developer,
      offset,
      pageSize,
    );

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
  publicClient: PublicClient,
  environmentConfig: EnvironmentConfig,
  appIDs: Address[],
): Promise<Map<Address, number>> {
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
  publicClient: PublicClient,
  blockNumbers: number[],
): Promise<Map<number, number>> {
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
 * Suspend options
 */
export interface SuspendOptions {
  walletClient: WalletClient;
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  account: Address;
  apps: Address[];
}

/**
 * Suspend apps for an account
 */
export async function suspend(
  options: SuspendOptions,
  logger: Logger = noopLogger,
): Promise<Hex | false> {
  const { walletClient, publicClient, environmentConfig, account, apps } = options;

  const suspendData = encodeFunctionData({
    abi: AppControllerABI,
    functionName: "suspend",
    args: [account, apps],
  });

  const pendingMessage = `Suspending ${apps.length} app(s)...`;

  return sendAndWaitForTransaction(
    {
      walletClient,
      publicClient,
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
 * Options for checking delegation status
 */
export interface IsDelegatedOptions {
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  address: Address;
}

/**
 * Check if account is delegated to the ERC-7702 delegator
 */
export async function isDelegated(options: IsDelegatedOptions): Promise<boolean> {
  const { publicClient, environmentConfig, address } = options;

  return checkERC7702Delegation(
    publicClient,
    address,
    environmentConfig.erc7702DelegatorAddress as Address,
  );
}

/**
 * Undelegate options
 */
export interface UndelegateOptions {
  walletClient: WalletClient;
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
}

/**
 * Undelegate account (removes EIP-7702 delegation)
 */
export async function undelegate(
  options: UndelegateOptions,
  logger: Logger = noopLogger,
): Promise<Hex> {
  const { walletClient, publicClient, environmentConfig } = options;

  const account = walletClient.account;
  if (!account) {
    throw new Error("WalletClient must have an account attached");
  }

  const chain = getChainFromID(environmentConfig.chainID);

  // Create authorization to undelegate (empty address = undelegate)
  const transactionNonce = await publicClient.getTransactionCount({
    address: account.address,
    blockTag: "pending",
  });

  const chainId = await publicClient.getChainId();
  const authorizationNonce = BigInt(transactionNonce) + 1n;

  logger.debug("Signing undelegate authorization");

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
