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
import { Address, Hex, encodeFunctionData, decodeErrorResult, bytesToHex, decodeFunctionData } from "viem";
import type { WalletClient, PublicClient } from "viem";

import {
  EnvironmentConfig,
  Logger,
  PreparedDeployData,
  PreparedUpgradeData,
  noopLogger,
  DeployProgressCallback,
  SequentialDeployResult,
} from "../types";
import { Release } from "../types";
import { getChainFromID } from "../utils/helpers";

import AppControllerABI from "../abis/AppController.json";
import PermissionControllerABI from "../abis/PermissionController.json";
import SafeTimelockFactoryABI from "../abis/SafeTimelockFactory.json";
import TimelockControllerABI from "../abis/TimelockController.json";

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
  /** Optional nonce override (for replacing stuck transactions) */
  nonce?: number;
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
  billTo?: "developer" | "app";
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

  const functionName = options.billTo === "app" ? "createAppWithIsolatedBilling" : "createApp";
  const createData = encodeFunctionData({
    abi: AppControllerABI,
    functionName,
    args: [saltHex, releaseForViem],
  });

  // 3. Assemble executions
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
  ];

  // 4. Add public logs permission if requested
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
      authorizationList: data.authorizationList,
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
 * This requires 1-2 wallet signatures instead of 1, but works with all wallet types.
 *
 * Steps:
 * 1. createApp - Creates the app on-chain
 * 2. setAppointee (optional) - Sets public logs permission
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
  const totalSteps = publicLogs ? "2" : "1";
  logger.info(`Step 1/${totalSteps}: Creating app...`);
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

  // Step 2: Set Public Logs (if requested and present in executions)
  if (publicLogs && data.executions.length > 1) {
    logger.info(`Step 2/${totalSteps}: Setting public logs permission...`);
    onProgress?.("setPublicLogs", createAppHash);

    const setAppointeeExecution = data.executions[1];
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

  onProgress?.("complete", txHashes.setPublicLogs || txHashes.createApp);

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
    if (typeof walletClient.getCapabilities !== "function") {
      return false;
    }

    const account = walletClient.account;
    if (!account) return false;

    // Try to get capabilities - if this works, the wallet supports EIP-5792
    const capabilities = await walletClient.getCapabilities({
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
  const filteredCalls = publicLogs ? calls : calls.slice(0, 1);

  logger.info(`Deploying with EIP-5792 sendCalls (${filteredCalls.length} calls)...`);
  onProgress?.("createApp");

  try {
    // Send all calls in a single batch
    const { id: batchId } = await walletClient.sendCalls({
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
        status = await walletClient.getCallsStatus({ id: batchId });

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
      authorizationList: data.authorizationList,
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
    ...(gas?.nonce != null && { nonce: gas.nonce }),
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
 * Get billing type for an app (0 = DEFAULT, 1 = ISOLATED)
 */
export async function getBillingType(
  publicClient: PublicClient,
  environmentConfig: EnvironmentConfig,
  app: Address,
): Promise<number> {
  const result = await publicClient.readContract({
    address: environmentConfig.appControllerAddress,
    abi: AppControllerABI,
    functionName: "getBillingType",
    args: [app],
  });
  return Number(result);
}

/**
 * Get apps by billing account (paginated)
 */
export async function getAppsByBillingAccount(
  publicClient: PublicClient,
  environmentConfig: EnvironmentConfig,
  account: Address,
  offset: bigint,
  limit: bigint,
): Promise<{ apps: Address[]; appConfigs: AppConfig[] }> {
  const result = (await publicClient.readContract({
    address: environmentConfig.appControllerAddress,
    abi: AppControllerABI,
    functionName: "getAppsByBillingAccount",
    args: [account, offset, limit],
  })) as [Address[], AppConfig[]];
  return { apps: result[0], appConfigs: result[1] };
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
 * Get whether an app is timelocked (owner is a Timelock — sensitive ops go through Timelock.schedule → execute)
 */
export async function getAppTimelocked(
  publicClient: PublicClient,
  environmentConfig: EnvironmentConfig,
  appID: Address,
): Promise<boolean> {
  const timelocked = await publicClient.readContract({
    address: environmentConfig.appControllerAddress as Address,
    abi: AppControllerABI,
    functionName: "getAppTimelocked",
    args: [appID],
  });

  return timelocked as boolean;
}

/**
 * Options for transferring app ownership
 */
export interface TransferOwnershipOptions {
  walletClient: WalletClient;
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  appID: Address;
  newOwner: Address;
  gas?: GasEstimate;
}

/**
 * Transfer ownership of an app to a new address.
 * If newOwner is a Safe or Timelock deployed by SafeTimelockFactory, governance mode is enabled automatically.
 */
export async function transferAppOwnership(
  options: TransferOwnershipOptions,
  logger: Logger = noopLogger,
): Promise<Hex> {
  const { walletClient, publicClient, environmentConfig, appID, newOwner, gas } = options;

  const data = encodeFunctionData({
    abi: AppControllerABI,
    functionName: "transferOwnership",
    args: [appID, newOwner],
  });

  return sendAndWaitForTransaction(
    {
      walletClient,
      publicClient,
      environmentConfig,
      to: environmentConfig.appControllerAddress as Address,
      data,
      pendingMessage: `Transferring ownership of app ${appID} to ${newOwner}...`,
      txDescription: "TransferOwnership",
      gas,
    },
    logger,
  );
}

/**
 * Team role enum matching the contract's TeamRole enum.
 */
export enum TeamRole {
  ADMIN = 0,
  PAUSER = 1,
  DEVELOPER = 2,
}

export interface GrantTeamRoleOptions {
  walletClient: WalletClient;
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  team: Address;
  role: TeamRole;
  account: Address;
  gas?: GasEstimate;
}

export async function grantTeamRole(
  options: GrantTeamRoleOptions,
  logger: Logger = noopLogger,
): Promise<Hex> {
  const { walletClient, publicClient, environmentConfig, team, role, account, gas } = options;

  const data = encodeFunctionData({
    abi: AppControllerABI,
    functionName: "grantTeamRole",
    args: [team, role, account],
  });

  return sendAndWaitForTransaction(
    {
      walletClient,
      publicClient,
      environmentConfig,
      to: environmentConfig.appControllerAddress as Address,
      data,
      pendingMessage: `Granting ${TeamRole[role]} role to ${account}...`,
      txDescription: "GrantTeamRole",
      gas,
    },
    logger,
  );
}

export interface RevokeTeamRoleOptions {
  walletClient: WalletClient;
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  team: Address;
  role: TeamRole;
  account: Address;
  gas?: GasEstimate;
}

export async function revokeTeamRole(
  options: RevokeTeamRoleOptions,
  logger: Logger = noopLogger,
): Promise<Hex> {
  const { walletClient, publicClient, environmentConfig, team, role, account, gas } = options;

  const data = encodeFunctionData({
    abi: AppControllerABI,
    functionName: "revokeTeamRole",
    args: [team, role, account],
  });

  return sendAndWaitForTransaction(
    {
      walletClient,
      publicClient,
      environmentConfig,
      to: environmentConfig.appControllerAddress as Address,
      data,
      pendingMessage: `Revoking ${TeamRole[role]} role from ${account}...`,
      txDescription: "RevokeTeamRole",
      gas,
    },
    logger,
  );
}

export async function getTeamRoleMembers(
  publicClient: PublicClient,
  environmentConfig: EnvironmentConfig,
  team: Address,
  role: TeamRole,
): Promise<Address[]> {
  return (await publicClient.readContract({
    address: environmentConfig.appControllerAddress as Address,
    abi: AppControllerABI,
    functionName: "getTeamRoleMembers",
    args: [team, role],
  })) as Address[];
}

export async function getAppOwner(
  publicClient: PublicClient,
  environmentConfig: EnvironmentConfig,
  appID: Address,
): Promise<Address> {
  return (await publicClient.readContract({
    address: environmentConfig.appControllerAddress as Address,
    abi: AppControllerABI,
    functionName: "getAppOwner",
    args: [appID],
  })) as Address;
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

// ─── SafeTimelockFactory ────────────────────────────────────────────────────

/**
 * Read the SafeTimelockFactory proxy address from AppController
 */
export async function getSafeTimelockFactoryAddress(
  publicClient: PublicClient,
  environmentConfig: EnvironmentConfig,
): Promise<Address> {
  return publicClient.readContract({
    address: environmentConfig.appControllerAddress as Address,
    abi: AppControllerABI as any,
    functionName: "safeTimelockFactory",
    args: [],
  }) as Promise<Address>;
}

/**
 * Canonical salt used for Timelock deployments via SafeTimelockFactory.
 *
 * Fixed at zero so that a single private key deterministically derives its
 * associated Timelock address — you can always reconstruct it from the EOA
 * without storing any extra state. Safe addresses are discovered via the
 * Safe Transaction Service API, not derived from this salt.
 */
export const CANONICAL_SALT: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";

export interface DeploySafeOptions {
  walletClient: WalletClient;
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  owners: Address[];
  threshold: number;
}

/**
 * Deploy a Gnosis Safe via SafeTimelockFactory
 */
export async function deploySafe(
  options: DeploySafeOptions,
  logger: Logger = noopLogger,
): Promise<{ tx: Hex | null; safe: Address; alreadyExisted?: boolean }> {
  const { walletClient, publicClient, environmentConfig, owners, threshold } = options;
  const salt = CANONICAL_SALT;

  const factoryAddress = await getSafeTimelockFactoryAddress(publicClient, environmentConfig);
  const account = walletClient.account!;
  const chain = getChainFromID(environmentConfig.chainID);

  // Predict the Safe address first. If bytecode already exists there, the Safe was
  // deployed previously (same deployer + same salt = same Create2 address). Skip
  // the deploy and return the existing address without sending a transaction.
  const predictedSafe = await publicClient.readContract({
    address: factoryAddress,
    abi: SafeTimelockFactoryABI,
    functionName: "calculateSafeAddress",
    args: [account.address, { owners, threshold: BigInt(threshold) }, salt],
  }) as Address;

  const existingCode = await publicClient.getCode({ address: predictedSafe });
  if (existingCode && existingCode !== "0x") {
    logger.info(`Safe already exists at ${predictedSafe}, skipping deploy`);
    return { tx: null, safe: predictedSafe, alreadyExisted: true };
  }

  const data = encodeFunctionData({
    abi: SafeTimelockFactoryABI,
    functionName: "deploySafe",
    args: [{ owners, threshold: BigInt(threshold) }, salt],
  });

  logger.debug(`Deploying Safe via factory ${factoryAddress}`);

  const hash = await walletClient.sendTransaction({ account, to: factoryAddress, data, chain });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status === "reverted") {
    throw new Error(`deploySafe transaction (${hash}) reverted`);
  }

  // Parse SafeDeployed event to get the deployed address
  // Use the second indexed topic (safe address) from the log
  const log = receipt.logs.find(
    (l) => l.address.toLowerCase() === factoryAddress.toLowerCase(),
  );
  if (!log || log.topics.length < 2) {
    throw new Error("SafeDeployed event not found in receipt");
  }
  const safe = ("0x" + log.topics[2]!.slice(26)) as Address;

  logger.info(`Safe deployed at ${safe}`);
  return { tx: hash, safe };
}

export interface DeployTimelockOptions {
  walletClient: WalletClient;
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  minDelay: bigint;
  proposers: Address[];
  executors: Address[];
  /** Salt for CREATE2 deployment. Defaults to CANONICAL_SALT (bytes32(0)). */
  salt?: Hex;
}

/**
 * Deploy a TimelockController via SafeTimelockFactory
 */
export async function deployTimelock(
  options: DeployTimelockOptions,
  logger: Logger = noopLogger,
): Promise<{ tx: Hex; timelock: Address }> {
  const { walletClient, publicClient, environmentConfig, minDelay, proposers, executors } = options;
  const salt = options.salt ?? CANONICAL_SALT;

  const factoryAddress = await getSafeTimelockFactoryAddress(publicClient, environmentConfig);
  const account = walletClient.account!;
  const chain = getChainFromID(environmentConfig.chainID);

  const data = encodeFunctionData({
    abi: SafeTimelockFactoryABI,
    functionName: "deployTimelock",
    args: [{ minDelay, proposers, executors }, salt],
  });

  logger.debug(`Deploying Timelock via factory ${factoryAddress}`);

  const hash = await walletClient.sendTransaction({ account, to: factoryAddress, data, chain });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status === "reverted") {
    throw new Error(`deployTimelock transaction (${hash}) reverted`);
  }

  // Parse TimelockDeployed event — second indexed topic is the timelock address
  const log = receipt.logs.find(
    (l) => l.address.toLowerCase() === factoryAddress.toLowerCase(),
  );
  if (!log || log.topics.length < 2) {
    throw new Error("TimelockDeployed event not found in receipt");
  }
  const timelock = ("0x" + log.topics[2]!.slice(26)) as Address;

  logger.info(`Timelock deployed at ${timelock}`);
  return { tx: hash, timelock };
}

export interface DiscoveredTimelock {
  address: Address;
  minDelay: bigint;
}

/**
 * Discover the canonical Timelock for an EOA address.
 *
 * Uses calculateTimelockAddress(eoa, bytes32(0)) to predict the deterministic
 * address, then checks isTimelock() to see if it has been deployed.
 * Returns null if no Timelock exists for this EOA.
 */
// ─── Timelocked operations via TimelockController ────────────────────────────
//
// All sensitive ops (upgradeApp, transferOwnership, terminateApp, grantTeamRole)
// go through TimelockController.schedule() → execute() uniformly when the app
// owner is a Timelock. The generic scheduleTimelockOp / executeTimelockOp
// helpers below handle any AppController calldata.
//
// We use predecessor=0 and salt=0 so the operation hash is deterministic from
// (target, calldata) alone.

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

export interface ScheduleTimelockOpOptions {
  walletClient: WalletClient;
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  timelockAddress: Address;
  calldata: Hex;
  delaySeconds: bigint;
  gas?: GasEstimate;
}

/**
 * Queue an AppController call through a TimelockController.
 * The wallet must hold the PROPOSER_ROLE on the given Timelock.
 */
export async function scheduleTimelockOp(
  options: ScheduleTimelockOpOptions,
  logger: Logger = noopLogger,
): Promise<Hex> {
  const { walletClient, publicClient, environmentConfig, timelockAddress, calldata, delaySeconds, gas } = options;

  const data = encodeFunctionData({
    abi: TimelockControllerABI,
    functionName: "schedule",
    args: [
      environmentConfig.appControllerAddress as Address,
      0n,
      calldata,
      ZERO_BYTES32,
      ZERO_BYTES32,
      delaySeconds,
    ],
  });

  return sendAndWaitForTransaction(
    {
      walletClient,
      publicClient,
      environmentConfig,
      to: timelockAddress,
      data,
      pendingMessage: `Queuing operation on Timelock ${timelockAddress}...`,
      txDescription: "TimelockSchedule",
      gas,
    },
    logger,
  );
}

export interface ExecuteTimelockOpOptions {
  walletClient: WalletClient;
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  timelockAddress: Address;
  calldata: Hex;
  gas?: GasEstimate;
}

/**
 * Execute a previously queued AppController call through a TimelockController.
 * The wallet must hold the EXECUTOR_ROLE (or the role must be open).
 */
export async function executeTimelockOp(
  options: ExecuteTimelockOpOptions,
  logger: Logger = noopLogger,
): Promise<Hex> {
  const { walletClient, publicClient, environmentConfig, timelockAddress, calldata, gas } = options;

  const data = encodeFunctionData({
    abi: TimelockControllerABI,
    functionName: "execute",
    args: [
      environmentConfig.appControllerAddress as Address,
      0n,
      calldata,
      ZERO_BYTES32,
      ZERO_BYTES32,
    ],
  });

  return sendAndWaitForTransaction(
    {
      walletClient,
      publicClient,
      environmentConfig,
      to: timelockAddress,
      data,
      pendingMessage: `Executing queued operation on Timelock ${timelockAddress}...`,
      txDescription: "TimelockExecute",
      gas,
    },
    logger,
  );
}

/**
 * Return the timestamp at which a queued operation becomes executable.
 * Returns 0 if the operation is not scheduled, 1 if it has already been executed.
 */
export async function getTimelockOpTimestamp(
  publicClient: PublicClient,
  timelockAddress: Address,
  appControllerAddress: Address,
  calldata: Hex,
): Promise<bigint> {
  const id = (await publicClient.readContract({
    address: timelockAddress,
    abi: TimelockControllerABI,
    functionName: "hashOperation",
    args: [appControllerAddress as Address, 0n, calldata, ZERO_BYTES32, ZERO_BYTES32],
  })) as Hex;

  return (await publicClient.readContract({
    address: timelockAddress,
    abi: TimelockControllerABI,
    functionName: "getTimestamp",
    args: [id],
  })) as bigint;
}

export async function discoverTimelock(
  publicClient: PublicClient,
  environmentConfig: EnvironmentConfig,
  proposerAddress: Address,
): Promise<DiscoveredTimelock | null> {
  const factoryAddress = await getSafeTimelockFactoryAddress(publicClient, environmentConfig);

  const timelockAddress = await publicClient.readContract({
    address: factoryAddress,
    abi: SafeTimelockFactoryABI,
    functionName: "calculateTimelockAddress",
    args: [proposerAddress, CANONICAL_SALT],
  }) as Address;

  const exists = await publicClient.readContract({
    address: factoryAddress,
    abi: SafeTimelockFactoryABI,
    functionName: "isTimelock",
    args: [timelockAddress],
  }) as boolean;

  if (!exists) return null;

  const minDelay = await publicClient.readContract({
    address: timelockAddress,
    abi: TimelockControllerABI,
    functionName: "getMinDelay",
    args: [],
  }) as bigint;

  return { address: timelockAddress, minDelay };
}

/** @deprecated Use discoverTimelock instead */
export const discoverTimelockForEOA = discoverTimelock;

/**
 * Returns all Timelocks deployed by the given deployer via SafeTimelockFactory.
 * Use this for identity recovery — no salt assumptions required.
 */
export async function getTimelocksByDeployer(
  publicClient: PublicClient,
  environmentConfig: EnvironmentConfig,
  deployer: Address,
): Promise<Address[]> {
  const factoryAddress = await getSafeTimelockFactoryAddress(publicClient, environmentConfig);
  return (await publicClient.readContract({
    address: factoryAddress,
    abi: SafeTimelockFactoryABI,
    functionName: "getTimelocksByDeployer",
    args: [deployer],
  })) as Address[];
}

/**
 * Returns all Safes deployed by the given deployer via SafeTimelockFactory.
 * Use this for identity recovery — no external API required.
 */
export async function getSafesByDeployer(
  publicClient: PublicClient,
  environmentConfig: EnvironmentConfig,
  deployer: Address,
): Promise<Address[]> {
  const factoryAddress = await getSafeTimelockFactoryAddress(publicClient, environmentConfig);
  return (await publicClient.readContract({
    address: factoryAddress,
    abi: SafeTimelockFactoryABI,
    functionName: "getSafesByDeployer",
    args: [deployer],
  })) as Address[];
}

export interface PendingTimelockOp {
  id: Hex;
  calldata: Hex;
  description: string;
  executableAt: bigint;
  ready: boolean;
}

function describeCalldata(calldata: Hex): string {
  try {
    const decoded = decodeFunctionData({ abi: AppControllerABI, data: calldata });
    return decoded.functionName;
  } catch {
    return "unknown";
  }
}

export async function getPendingTimelockOps(
  publicClient: PublicClient,
  timelockAddress: Address,
): Promise<PendingTimelockOp[]> {
  // Uses getPendingOperations() from TimelockControllerImpl — single view call, no log scanning.
  let ops: { id: Hex; target: Address; data: Hex; executableAt: bigint }[];
  try {
    ops = (await publicClient.readContract({
      address: timelockAddress,
      abi: TimelockControllerABI,
      functionName: "getPendingOperations",
      args: [],
    })) as { id: Hex; target: Address; data: Hex; executableAt: bigint }[];
  } catch {
    // Timelock deployed before upgrade — getPendingOperations not available
    return [];
  }

  if (ops.length === 0) return [];

  const now = BigInt(Math.floor(Date.now() / 1000));
  return ops.map((op) => ({
    id: op.id,
    calldata: op.data,
    description: op.data && op.data !== "0x" ? describeCalldata(op.data) : "batch op",
    executableAt: op.executableAt,
    ready: now >= op.executableAt,
  }));
}
