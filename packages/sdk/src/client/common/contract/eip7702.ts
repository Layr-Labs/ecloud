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

import { GasEstimate, formatETH } from "./caller";

/**
 * Options for estimating batch gas
 */
export interface EstimateBatchGasOptions {
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  executions: Array<{
    target: Address;
    value: bigint;
    callData: Hex;
  }>;
}

/**
 * Estimate gas cost for a batch transaction
 * 
 * Use this to get cost estimate before prompting user for confirmation.
 * Note: This provides a conservative estimate since batch transactions
 * through EIP-7702 can have variable costs.
 */
export async function estimateBatchGas(
  options: EstimateBatchGasOptions,
): Promise<GasEstimate> {
  const { publicClient, executions } = options;

  // Get current gas prices
  const fees = await publicClient.estimateFeesPerGas();

  // For batch operations, we use a conservative estimate
  // Each execution adds ~50k gas, plus base cost of ~100k for the delegator call
  const baseGas = 100000n;
  const perExecutionGas = 50000n;
  const estimatedGas = baseGas + (BigInt(executions.length) * perExecutionGas);
  
  // Add 20% buffer for safety
  const gasLimit = (estimatedGas * 120n) / 100n;

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

export interface ExecuteBatchOptions {
  walletClient: WalletClient;
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  executions: Array<{
    target: Address;
    value: bigint;
    callData: Hex;
  }>;
  pendingMessage: string;
  privateKey?: Hex; // Private key for signing raw hash (required for authorization signing)
  /** Optional gas params from estimation */
  gas?: {
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
  };
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
    pendingMessage,
    privateKey,
    gas,
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

  // 5. Show pending message
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

  // Add gas params if provided
  if (gas?.maxFeePerGas) {
    txRequest.maxFeePerGas = gas.maxFeePerGas;
  }
  if (gas?.maxPriorityFeePerGas) {
    txRequest.maxPriorityFeePerGas = gas.maxPriorityFeePerGas;
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