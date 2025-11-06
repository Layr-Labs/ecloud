/**
 * Contract interactions
 * 
 * This module handles on-chain contract interactions using viem
 */

import { createWalletClient, createPublicClient, http, Address, Hex, encodeFunctionData, decodeFunctionResult } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { EnvironmentConfig, Logger } from '../types';
import { Release } from '../types';
import { executeBatch } from './eip7702';

import AppControllerABI from './abis/AppController.json';
import PermissionControllerABI from './abis/PermissionController.json';

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
  salt: Uint8Array
): Promise<Address> {
  const privateKeyHex = typeof privateKey === 'string' 
    ? (privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) as Hex
    : privateKey;
  const account = privateKeyToAccount(privateKeyHex);
  const publicClient = createPublicClient({
    transport: http(rpcUrl),
  });

  const appID = await publicClient.readContract({
    address: environmentConfig.appControllerAddress as Address,
    abi: AppControllerABI,
    functionName: 'calculateAppId',
    args: [account.address, `0x${Buffer.from(salt).toString('hex')}`],
  });

  return appID as Address;
}

/**
 * Deploy app on-chain
 */
export async function deployApp(
  options: DeployAppOptions,
  logger: Logger
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

  const privateKeyHex = typeof privateKey === 'string' 
    ? (privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) as Hex
    : privateKey;
  const account = privateKeyToAccount(privateKeyHex);
  const publicClient = createPublicClient({
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    transport: http(rpcUrl),
  });

  // 1. Calculate app ID
  logger.info('Calculating app ID...');
  const appAddress = await calculateAppID(
    privateKeyHex,
    rpcUrl,
    environmentConfig,
    salt
  );
  logger.info(`App ID: ${appAddress}`);

  // 2. Pack create app call
  const createData = encodeFunctionData({
    abi: AppControllerABI,
    functionName: 'createApp',
    args: [`0x${Buffer.from(salt).toString('hex')}`, release],
  });

  // 3. Pack accept admin call
  const acceptAdminData = encodeFunctionData({
    abi: PermissionControllerABI,
    functionName: 'acceptAdmin',
    args: [appAddress],
  });

  // 4. Assemble executions
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
      functionName: 'setAppointee',
      args: [
        appAddress,
        '0x493219d9949348178af1f58740655951a8cd110c' as Address, // AnyoneCanCallAddress
        '0x57ee1fb74c1087e26446abc4fb87fd8f07c43d8d' as Address, // ApiPermissionsTarget
        '0x2fd3f2fe' as Hex, // CanViewAppLogsPermission
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
  const pendingMessage = 'Deploying new app...';

  const txHash = await executeBatch(
    {
      walletClient,
      publicClient,
      environmentConfig,
      executions,
      needsConfirmation: environmentConfig.chainID === 1n, // Mainnet needs confirmation
      confirmationPrompt,
      pendingMessage,
    },
    logger
  );

  return { appAddress, txHash };
}
