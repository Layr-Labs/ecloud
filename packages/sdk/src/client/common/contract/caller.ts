/**
 * Contract interactions
 *
 * This module handles on-chain contract interactions using viem
 */

import { sepolia, mainnet } from "viem/chains";
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
import { hashAuthorization } from "viem/utils";
import { sign } from "viem/accounts";

import { confirm } from "../utils/prompts";

import { EnvironmentConfig, Logger } from "../types";
import { Release } from "../types";
import { getAppName } from "../registry/appNames";

import AppControllerABI from "../abis/AppController.json";
import PermissionControllerABI from "../abis/PermissionController.json";
import chalk from "chalk";


export interface DeployAppOptions {
  privateKey: string; // Will be converted to Hex
  rpcUrl: string;
  environmentConfig: EnvironmentConfig;
  salt: Uint8Array;
  release: Release;
  publicLogs: boolean;
  imageRef: string;
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
  const privateKeyHex =
    typeof privateKey === "string"
      ? ((privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as Hex)
      : privateKey;
  const account = privateKeyToAccount(privateKeyHex);

  // Map chainID to viem Chain
  const chain =
    environmentConfig.chainID === 11155111n
      ? sepolia
      : environmentConfig.chainID === 1n
        ? mainnet
        : sepolia; // Default to sepolia if unknown

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
    typeof account.address === "string"
      ? account.address
      : (account.address as Buffer).toString();

  const appID = await publicClient.readContract({
    address: environmentConfig.appControllerAddress as Address,
    abi: AppControllerABI,
    functionName: "calculateAppId",
    args: [accountAddress as Address, saltHex],
  });

  return appID as Address;
}

/**
 * Deploy app on-chain
 */
export async function deployApp(
  options: DeployAppOptions,
  logger: Logger,
): Promise<{ appAddress: Address; txHash: Hex }> {
  const {
    privateKey,
    rpcUrl,
    environmentConfig,
    salt,
    release,
    publicLogs,
    imageRef,
  } = options;

  const privateKeyHex =
    typeof privateKey === "string"
      ? ((privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as Hex)
      : privateKey;
  const account = privateKeyToAccount(privateKeyHex);

  // Map chainID to viem Chain
  const chain =
    environmentConfig.chainID === 11155111n
      ? sepolia
      : environmentConfig.chainID === 1n
        ? mainnet
        : sepolia; // Default to sepolia if unknown

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
  const appAddress = await calculateAppID(
    privateKeyHex,
    rpcUrl,
    environmentConfig,
    salt,
  );
  logger.info(`App ID: ${appAddress}`);

  // Verify the app address calculation matches what createApp will deploy
  // This ensures we're calling acceptAdmin on the correct app address
  logger.debug(`App address calculated: ${appAddress}`);
  logger.debug(`This address will be used for acceptAdmin call`);

  // 2. Pack create app call
  // Ensure salt is properly formatted as hex string (32 bytes = 64 hex chars)
  const saltHexString = Buffer.from(salt).toString("hex");
  // Pad to 64 characters if needed (shouldn't be needed for 32 bytes, but just in case)
  const paddedSaltHex = saltHexString.padStart(64, "0");
  const saltHex = `0x${paddedSaltHex}` as Hex;

  // Convert Release Uint8Array values to hex strings for viem
  // Viem expects hex strings for bytes and bytes32 types
  const releaseForViem = {
    rmsRelease: {
      artifacts: release.rmsRelease.artifacts.map((artifact) => ({
        digest:
          `0x${Buffer.from(artifact.digest).toString("hex").padStart(64, "0")}` as Hex,
        registry: artifact.registry,
      })),
      upgradeByTime: release.rmsRelease.upgradeByTime,
    },
    publicEnv: `0x${Buffer.from(release.publicEnv).toString("hex")}` as Hex,
    encryptedEnv:
      `0x${Buffer.from(release.encryptedEnv).toString("hex")}` as Hex,
  };

  const createData = encodeFunctionData({
    abi: AppControllerABI,
    functionName: "createApp",
    args: [saltHex, releaseForViem],
  });

  // 3. Pack accept admin call
  // NOTE: createApp calls initialize(admin) which adds the EOA (msg.sender) as a pending admin
  // for the app account. So acceptAdmin should work when called from the EOA.
  // The execution order in the batch ensures createApp completes before acceptAdmin runs.
  const acceptAdminData = encodeFunctionData({
    abi: PermissionControllerABI,
    functionName: "acceptAdmin",
    args: [appAddress],
  });

  // 4. Assemble executions
  // CRITICAL: Order matters! createApp must complete first to call initialize(admin)
  // which adds the EOA as a pending admin. Then acceptAdmin can be called.
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
        appAddress,
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

  // 6. Execute batch via EIP-7702 delegator
  const confirmationPrompt = `Deploy new app with image: ${imageRef}`;
  const pendingMessage = "Deploying new app...";

  const txHash = await executeBatch(
    {
      walletClient,
      publicClient,
      environmentConfig,
      executions,
      needsConfirmation: environmentConfig.chainID === 1n, // Mainnet needs confirmation
      confirmationPrompt,
      pendingMessage,
      privateKey: privateKeyHex, // Pass private key for manual transaction signing
    },
    logger,
  );

  return { appAddress, txHash };
}

export interface UpgradeAppOptions {
  privateKey: string; // Will be converted to Hex
  rpcUrl: string;
  environmentConfig: EnvironmentConfig;
  appID: Address;
  release: Release;
  publicLogs: boolean;
  needsPermissionChange: boolean;
  imageRef: string;
}

/**
 * Upgrade app on-chain
 */
export async function upgradeApp(
  options: UpgradeAppOptions,
  logger: Logger,
): Promise<Hex> {
  const {
    privateKey,
    rpcUrl,
    environmentConfig,
    appID,
    release,
    publicLogs,
    needsPermissionChange,
    imageRef,
  } = options;

  const privateKeyHex =
    typeof privateKey === "string"
      ? ((privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as Hex)
      : privateKey;
  const account = privateKeyToAccount(privateKeyHex);

  // Map chainID to viem Chain
  const chain =
    environmentConfig.chainID === 11155111n
      ? sepolia
      : environmentConfig.chainID === 1n
        ? mainnet
        : sepolia; // Default to sepolia if unknown

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
        digest:
          `0x${Buffer.from(artifact.digest).toString("hex").padStart(64, "0")}` as Hex,
        registry: artifact.registry,
      })),
      upgradeByTime: release.rmsRelease.upgradeByTime,
    },
    publicEnv: `0x${Buffer.from(release.publicEnv).toString("hex")}` as Hex,
    encryptedEnv:
      `0x${Buffer.from(release.encryptedEnv).toString("hex")}` as Hex,
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

  // 4. Execute batch via EIP-7702 delegator
  // Get app name for confirmation prompt
  const appName = getAppName(environmentConfig.name, appID);
  let confirmationPrompt = "Upgrade app";
  let pendingMessage = "Upgrading app...";
  if (appName !== "") {
    confirmationPrompt = `${confirmationPrompt} '${appName}'`;
    pendingMessage = `Upgrading app '${appName}'...`;
  }
  confirmationPrompt = `${confirmationPrompt} with image: ${imageRef}`;

  const txHash = await executeBatch(
    {
      walletClient,
      publicClient,
      environmentConfig,
      executions,
      needsConfirmation: environmentConfig.chainID === 1n, // Mainnet needs confirmation
      confirmationPrompt,
      pendingMessage,
      privateKey: privateKeyHex, // Pass private key for manual transaction signing
    },
    logger,
  );

  return txHash;
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
  needsConfirmation: boolean;
  confirmationPrompt: string;
  pendingMessage: string;
  txDescription: string;
}

export async function sendAndWaitForTransaction(
  options: SendTransactionOptions,
  logger: Logger,
): Promise<Hex | false> {
  const {
    privateKey,
    rpcUrl,
    environmentConfig,
    to,
    data,
    value = 0n,
    needsConfirmation,
    confirmationPrompt,
    pendingMessage,
    txDescription,
  } = options;

  const privateKeyHex =
    typeof privateKey === "string"
      ? ((privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as Hex)
      : privateKey;
  const account = privateKeyToAccount(privateKeyHex);

  const chain =
    environmentConfig.chainID === 11155111n
      ? sepolia
      : environmentConfig.chainID === 1n
        ? mainnet
        : sepolia;

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

  // Handle confirmation if needed
  if (needsConfirmation) {
    try {
      const fees = await publicClient.estimateFeesPerGas();
      const gasEstimate = await publicClient.estimateGas({
        account: account.address,
        to,
        data,
        value,
      });
      const maxCostWei = gasEstimate * fees.maxFeePerGas;
      const costEth = formatETH(maxCostWei);

      // place an empty line for tidier output
      logger.info("");
      
      // Interactive confirmation prompt
      if (!(await confirm(`${confirmationPrompt} ${chalk.reset(`on ${environmentConfig.name} (max cost: ${costEth} ETH)`)}`))) {
        return false;
      }
    } catch (error: any) {
      // Try to parse custom contract errors
      const parsedErr = parseEstimateGasError(error, environmentConfig);
      if (parsedErr) {
        throw parsedErr;
      }
      logger.warn(`Could not estimate cost for confirmation: ${error}`);
    }
  }

  // Show pending message if provided
  if (pendingMessage) {
    logger.info(`\n${pendingMessage}`);
  }

  // Send transaction
  const hash = await walletClient.sendTransaction({
    account,
    to,
    data,
    value,
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
          revertReason = `${decoded.errorName}: ${JSON.stringify(decoded.args)}`;
        } catch {
          revertReason = callError.message || "Unknown reason";
        }
      } else {
        revertReason = callError.message || "Unknown reason";
      }
    }
    logger.error(
      `${txDescription} transaction (hash: ${hash}) reverted: ${revertReason}`,
    );
    throw new Error(
      `${txDescription} transaction (hash: ${hash}) reverted: ${revertReason}`,
    );
  }

  return hash;
}

/**
 * Parse estimate gas errors to extract contract-specific error messages
 */
function parseEstimateGasError(
  err: any,
  environmentConfig: EnvironmentConfig,
): Error | null {
  if (!err) {
    return null;
  }

  // Check if error has data property (viem/ethers RPC errors)
  const errorData = err.data || err.error?.data;
  if (!errorData) {
    return null;
  }

  // Convert data to hex string if needed
  let hexData: string;
  if (typeof errorData === "string") {
    hexData = errorData;
  } else if (Buffer.isBuffer(errorData)) {
    hexData = `0x${errorData.toString("hex")}`;
  } else {
    return null;
  }

  if (hexData.length < 10) {
    // Need at least 4 bytes (0x + 8 hex chars) for function selector
    return null;
  }

  // Try to decode the error
  try {
    const decoded = decodeErrorResult({
      abi: AppControllerABI,
      data: hexData as Hex,
    });
    return formatAppControllerError(decoded);
  } catch {
    return null;
  }
}

/**
 * Format AppController errors to user-friendly messages
 */
function formatAppControllerError(decoded: any): Error {
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
 * Format Wei to ETH string
 */
function formatETH(wei: bigint): string {
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
 * Get active app count for a user
 */
export async function getActiveAppCount(
  rpcUrl: string,
  environmentConfig: EnvironmentConfig,
  user: Address,
): Promise<number> {
  const chain =
    environmentConfig.chainID === 11155111n
      ? sepolia
      : environmentConfig.chainID === 1n
        ? mainnet
        : sepolia;

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
  const chain =
    environmentConfig.chainID === 11155111n
      ? sepolia
      : environmentConfig.chainID === 1n
        ? mainnet
        : sepolia;

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
  const chain =
    environmentConfig.chainID === 11155111n
      ? sepolia
      : environmentConfig.chainID === 1n
        ? mainnet
        : sepolia;

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
  const chain =
    environmentConfig.chainID === 11155111n
      ? sepolia
      : environmentConfig.chainID === 1n
        ? mainnet
        : sepolia;

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
  pageSize: bigint = 100n
): Promise<{ apps: Address[]; appConfigs: AppConfig[] }> {

  let offset = 0n;
  const allApps: Address[] = [];
  const allConfigs: AppConfig[] = [];

  while (true) {
    const { apps, appConfigs } = await getAppsByDeveloper(
      rpcUrl,
      env,
      developer,
      offset,
      pageSize
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
  const confirmationPrompt = `Suspend ${apps.length} app(s) for account ${account}`;

  return sendAndWaitForTransaction(
    {
      privateKey,
      rpcUrl,
      environmentConfig,
      to: environmentConfig.appControllerAddress as Address,
      data: suspendData,
      needsConfirmation: environmentConfig.chainID === 1n,
      confirmationPrompt,
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

  const privateKeyHex =
    typeof privateKey === "string"
      ? ((privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as Hex)
      : privateKey;
  const account = privateKeyToAccount(privateKeyHex);

  const chain =
    environmentConfig.chainID === 11155111n
      ? sepolia
      : environmentConfig.chainID === 1n
        ? mainnet
        : sepolia;

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

  const confirmationPrompt = "Undelegate account (removes EIP-7702 delegation)";
  const pendingMessage = "Undelegating account...";

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
