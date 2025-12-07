/**
 * EIP-7702 transaction handling
 *
 * This module handles EIP-7702 delegation and batch execution
 */

import {
  Address,
  Hex,
  encodeFunctionData,
  encodeAbiParameters,
  decodeErrorResult,
  keccak256,
  toBytes,
  concat,
} from "viem";
import { hashAuthorization } from "viem/utils";
import { sign } from "viem/accounts";

import type { WalletClient, PublicClient } from "viem";
import { EnvironmentConfig, Logger } from "../types";

import ERC7702DelegatorABI from "../abis/ERC7702Delegator.json";

/**
 * Confirmation callback type for mainnet transactions
 * Called with the confirmation prompt and estimated max cost in ETH
 * Should return true to proceed or false to abort
 */
export type ConfirmationCallback = (prompt: string, maxCostEth: string) => Promise<boolean>;

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
  privateKey?: Hex; // Private key for signing raw hash (required for authorization signing)
  /** Optional confirmation callback for mainnet transactions */
  onConfirm?: ConfirmationCallback;
}

/**
 * Check if account is delegated to ERC-7702 delegator
 */
export async function checkERC7702Delegation(
  publicClient: PublicClient,
  account: Address,
  delegatorAddress: Address,
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
 * Execute batch of operations via EIP-7702 delegator
 *
 * This function uses viem's built-in EIP-7702 support to handle transaction
 * construction, signing, and sending. We focus on:
 * 1. Encoding the executions correctly
 * 2. Creating authorization if needed
 * 3. Passing the right parameters to viem
 */
export async function executeBatch(
  options: ExecuteBatchOptions,
  logger: Logger,
): Promise<Hex> {
  const {
    walletClient,
    publicClient,
    environmentConfig,
    executions,
    needsConfirmation,
    confirmationPrompt,
    pendingMessage,
    privateKey,
    onConfirm,
  } = options;

  const account = walletClient.account;
  if (!account) {
    throw new Error("Wallet client must have an account");
  }

  const chain = walletClient.chain;
  if (!chain) {
    throw new Error("Wallet client must have a chain");
  }

  // 1. Encode executions array
  // The Execution struct is: { target: address, value: uint256, callData: bytes }
  // Go's EncodeExecutions uses abi.Arguments.Pack which produces standard ABI encoding
  const encodedExecutions = encodeAbiParameters(
    [
      {
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    [executions],
  );

  // 2. Pack ExecuteBatch call
  // Mode 0x01 is executeBatchMode (32 bytes, padded) (big endian)
  const executeBatchMode =
    "0x0100000000000000000000000000000000000000000000000000000000000000" as Hex;

  // Encode the execute function call
  // Function signature: execute(bytes32 _mode, bytes _executionCalldata)
  // Function selector: 0xe9ae5c53
  let executeBatchData: Hex;
  try {
    executeBatchData = encodeFunctionData({
      abi: ERC7702DelegatorABI,
      functionName: "execute",
      args: [executeBatchMode, encodedExecutions],
    });
  } catch {
    // Fallback: Manually construct if viem selects wrong overload
    const functionSignature = "execute(bytes32,bytes)";
    const selector = keccak256(toBytes(functionSignature)).slice(0, 10) as Hex;
    const encodedParams = encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes" }],
      [executeBatchMode, encodedExecutions],
    );
    executeBatchData = concat([selector as Hex, encodedParams]) as Hex;
  }

  // 3. Check if account is delegated
  const isDelegated = await checkERC7702Delegation(
    publicClient,
    account.address,
    environmentConfig.erc7702DelegatorAddress as Address,
  );

  // 4. Create authorization if needed
  let authorizationList: Array<{
    chainId: number;
    address: Address;
    nonce: number;
    r: Hex;
    s: Hex;
    yParity: number;
  }> = [];

  if (!isDelegated) {
    if (!privateKey) {
      throw new Error("Private key required for signing authorization");
    }

    const transactionNonce = await publicClient.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    });

    const chainId = await publicClient.getChainId();
    const authorizationNonce = BigInt(transactionNonce) + 1n;

    const authorization = {
      chainId: Number(chainId),
      address: environmentConfig.erc7702DelegatorAddress as Address,
      nonce: authorizationNonce,
    };

    const sighash = hashAuthorization({
      chainId: authorization.chainId,
      contractAddress: authorization.address,
      nonce: Number(authorization.nonce),
    });

    const sig = await sign({
      hash: sighash,
      privateKey,
    });

    const v = Number(sig.v);
    const yParity = v === 27 ? 0 : 1;

    authorizationList = [
      {
        chainId: authorization.chainId,
        address: authorization.address,
        nonce: Number(authorization.nonce),
        r: sig.r as Hex,
        s: sig.s as Hex,
        yParity,
      },
    ];
  }

  // 5. Send transaction using viem
  if (needsConfirmation) {
    try {
      const fees = await publicClient.estimateFeesPerGas();
      const estimatedGas = 2000000n;
      const maxCostWei = estimatedGas * fees.maxFeePerGas;
      const costEth = formatETH(maxCostWei);
      
      // Use confirmation callback if provided
      if (onConfirm) {
        const fullPrompt = `${confirmationPrompt} on ${environmentConfig.name} (estimated max cost: ${costEth} ETH)`;
        if (!(await onConfirm(fullPrompt, costEth))) {
          throw new Error("Transaction cancelled by user");
        }
      } else {
        // No callback provided - throw error for mainnet transactions
        throw new Error(
          `Mainnet transaction requires confirmation. Please provide an onConfirm callback or use the CLI for interactive confirmation.`
        );
      }
    } catch (error: any) {
      // Re-throw confirmation/cancellation errors
      if (error.message?.includes("requires confirmation") || error.message?.includes("cancelled by user")) {
        throw error;
      }
      logger.warn(`Could not estimate cost for confirmation: ${error}`);
    }
  }

  if (pendingMessage) {
    logger.info(pendingMessage);
  }

  const txRequest: any = {
    account: walletClient.account!,
    chain,
    to: account.address,
    data: executeBatchData,
    value: 0n,
  };

  if (authorizationList.length > 0) {
    txRequest.authorizationList = authorizationList;
  }

  const hash = await walletClient.sendTransaction(txRequest);
  logger.info(`Transaction sent: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status === "reverted") {
    let revertReason = "Unknown reason";
    try {
      await publicClient.call({
        to: account.address,
        data: executeBatchData,
        account: account.address,
      });
    } catch (callError: any) {
      if (callError.data) {
        try {
          const decoded = decodeErrorResult({
            abi: ERC7702DelegatorABI,
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
    throw new Error(`Transaction reverted: ${hash}. Reason: ${revertReason}`);
  }

  return hash;
}

/**
 * Format Wei to ETH string
 */
function formatETH(wei: bigint): string {
  const eth = Number(wei) / 1e18;
  return eth.toFixed(6);
}
