/**
 * EIP-7702 transaction handling
 * 
 * This module handles EIP-7702 delegation and batch execution
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  Address,
  Hex,
  encodeFunctionData,
  type WalletClient,
  type PublicClient,
} from 'viem';
import { EnvironmentConfig, Logger } from '../types';

import ERC7702DelegatorABI from './abis/ERC7702Delegator.json';

export interface ExecuteBatchOptions {
  walletClient: WalletClient;
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  executions: Array<{
    target: Address;
    value: bigint;
    callData: Hex;
  }>;
  needsConfirmation: boolean;
  confirmationPrompt: string;
  pendingMessage: string;
}

/**
 * Check if account is delegated to ERC-7702 delegator
 */
export async function checkERC7702Delegation(
  publicClient: PublicClient,
  account: Address,
  delegatorAddress: Address
): Promise<boolean> {
  const code = await publicClient.getBytecode({ address: account });
  if (!code) {
    return false;
  }

  // Check if code matches EIP-7702 delegation pattern: 0xef0100 || delegator_address
  const expectedCode = `0xef0100${delegatorAddress.slice(2)}`;
  return code.toLowerCase() === expectedCode.toLowerCase();
}

/**
 * Create authorization signature for EIP-7702
 */
export async function createAuthorization(
  walletClient: WalletClient,
  publicClient: PublicClient,
  delegatorAddress: Address
): Promise<{
  chainId: number;
  address: Address;
  nonce: bigint;
  signature: Hex;
}> {
  const account = walletClient.account;
  if (!account) {
    throw new Error('Wallet client must have an account');
  }

  // Get current nonce
  const nonce = await publicClient.getTransactionCount({
    address: account.address,
  });

  // Increment nonce for authorization
  const authorizationNonce = BigInt(nonce) + 1n;

  // Get chain ID
  const chainId = await publicClient.getChainId();

  // Create authorization tuple for ERC-7702 delegation
  const authorization = {
    chainId,
    address: delegatorAddress,
    nonce: authorizationNonce,
  };

  // Sign the authorization
  // Note: viem handles EIP-7702 authorization signing automatically
  // when using sendTransaction with authorizationList
  return {
    ...authorization,
    signature: '0x' as Hex, // Placeholder - viem handles this internally
  };
}

/**
 * Execute batch of operations via EIP-7702 delegator
 */
export async function executeBatch(
  options: ExecuteBatchOptions,
  logger: Logger
): Promise<Hex> {
  const {
    walletClient,
    publicClient,
    environmentConfig,
    executions,
    needsConfirmation,
    confirmationPrompt,
    pendingMessage,
  } = options;

  const account = walletClient.account;
  if (!account) {
    throw new Error('Wallet client must have an account');
  }

  const chain = walletClient.chain
  if (!chain) {
    throw new Error('Wallet client must have an chain');
  }

  // 1. Encode executions
  const encodedExecutions = encodeFunctionData({
    abi: ERC7702DelegatorABI,
    functionName: 'encodeExecutions',
    args: [executions],
  });

  // 2. Pack ExecuteBatch call
  const executeBatchData = encodeFunctionData({
    abi: ERC7702DelegatorABI,
    functionName: 'execute',
    args: [
      '0x01' as Hex, // executeBatchMode
      encodedExecutions,
    ],
  });

  // 3. Check if account is delegated
  const isDelegated = await checkERC7702Delegation(
    publicClient,
    account.address,
    environmentConfig.erc7702DelegatorAddress as Address
  );

  // 4. Create authorization if not delegated
  let authorizationList: Array<{
    chainId: number;
    address: Address;
    nonce: number;
  }> = [];

  if (!isDelegated) {
    logger.debug('Account not delegated, creating authorization...');
    const authorization = await createAuthorization(
      walletClient,
      publicClient,
      environmentConfig.erc7702DelegatorAddress as Address
    );
    authorizationList = [
      {
        chainId: +(authorization.chainId.toString()),
        address: authorization.address,
        nonce: +(authorization.nonce.toString()),
      },
    ];
  }

  // 5. Handle confirmation if needed
  if (needsConfirmation) {
    // Estimate gas to calculate cost
    try {
      const gasEstimate = await publicClient.estimateGas({
        account: account.address,
        to: account.address, // EIP-7702 txs send to themselves
        data: executeBatchData,
        authorizationList,
      });

      const gasPrice = await publicClient.getGasPrice();
      const maxCostWei = gasEstimate * gasPrice;
      const costEth = formatETH(maxCostWei);

      logger.info(`${confirmationPrompt} on ${environmentConfig.name} (max cost: ${costEth} ETH)`);
      // const confirmed = await promptConfirmation('Continue?');
      // if (!confirmed) {
      //   throw new Error('Operation cancelled');
      // }
    } catch (error: any) {
      logger.warn(`Failed to estimate gas: ${error.message}`);
    }
  }

  // 6. Show pending message
  if (pendingMessage) {
    logger.info(pendingMessage);
  }

  // 7. Send transaction
  try {
    const hash = await walletClient.sendTransaction({
      account: account.address,
      chain,
      to: account.address, // EIP-7702 txs send to themselves
      data: executeBatchData,
      authorizationList,
    });

    // 8. Wait for transaction receipt
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === 'reverted') {
      throw new Error(`Transaction reverted: ${hash}`);
    }

    return hash;
  } catch (error: any) {
    throw new Error(`Failed to execute batch: ${error.message}`);
  }
}

/**
 * Format Wei to ETH string
 */
function formatETH(wei: bigint): string {
  const eth = Number(wei) / 1e18;
  return eth.toFixed(6);
}

