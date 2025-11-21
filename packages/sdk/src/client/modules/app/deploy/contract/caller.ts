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
} from "viem";

import { EnvironmentConfig, Logger } from "../../../../common/types";
import { Release } from "../../../../common/types";

import AppControllerABI from "../../../../common/abis/AppController.json";
import PermissionControllerABI from "../../../../common/abis/PermissionController.json";

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
  // Pad to 64 characters if needed (shouldn't be needed for 32 bytes, but just in case)
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
