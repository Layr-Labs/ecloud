/**
 * EIP-7702 transaction handling
 *
 * This module handles EIP-7702 delegation and batch execution.
 */

import { Address, Hex, encodeFunctionData, encodeAbiParameters, decodeErrorResult } from "viem";

import type {
  WalletClient,
  PublicClient,
  SendTransactionParameters,
  SignAuthorizationReturnType,
} from "viem";
import { EnvironmentConfig, Logger, noopLogger } from "../types";

import ERC7702DelegatorABI from "../abis/ERC7702Delegator.json";

import { GasEstimate, formatETH } from "./caller";

// Mode 0x01 is executeBatchMode (32 bytes, padded, big endian)
const EXECUTE_BATCH_MODE =
  "0x0100000000000000000000000000000000000000000000000000000000000000" as Hex;

const GAS_LIMIT_BUFFER_PERCENTAGE = 20n; // 20%
const GAS_PRICE_BUFFER_PERCENTAGE = 100n; // 100%

export type Execution = {
  target: Address;
  value: bigint;
  callData: Hex;
};

/**
 * Encode executions array and pack into execute function call data
 */
function encodeExecuteBatchData(executions: Execution[]): Hex {
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

  return encodeFunctionData({
    abi: ERC7702DelegatorABI,
    functionName: "execute",
    args: [EXECUTE_BATCH_MODE, encodedExecutions],
  });
}

/**
 * Options for estimating batch gas
 */
export interface EstimateBatchGasOptions {
  publicClient: PublicClient;
  account: Address;
  executions: Execution[];
}

/**
 * Estimate gas cost for a batch transaction
 *
 * Use this to get cost estimate before prompting user for confirmation.
 */
export async function estimateBatchGas(options: EstimateBatchGasOptions): Promise<GasEstimate> {
  const { publicClient, account, executions } = options;

  const executeBatchData = encodeExecuteBatchData(executions);

  // EIP-7702 transactions send to self (the EOA with delegated code)
  const [gasTipCap, block, estimatedGas] = await Promise.all([
    publicClient.estimateMaxPriorityFeePerGas(),
    publicClient.getBlock(),
    publicClient.estimateGas({
      account,
      to: account,
      data: executeBatchData,
    }),
  ]);

  const baseFee = block.baseFeePerGas ?? 0n;

  // Calculate gas price with 100% buffer: (baseFee + gasTipCap) * 2
  const maxFeePerGas = ((baseFee + gasTipCap) * (100n + GAS_PRICE_BUFFER_PERCENTAGE)) / 100n;

  // Add 20% buffer to gas limit
  const gasLimit = (estimatedGas * (100n + GAS_LIMIT_BUFFER_PERCENTAGE)) / 100n;

  const maxCostWei = gasLimit * maxFeePerGas;

  return {
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas: gasTipCap,
    maxCostWei,
    maxCostEth: formatETH(maxCostWei),
  };
}

export interface ExecuteBatchOptions {
  walletClient: WalletClient;
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  executions: Execution[];
  pendingMessage: string;
  /** Optional gas params from estimation */
  gas?: GasEstimate;
}

/**
 * Check if account is delegated to ERC-7702 delegator
 */
export async function checkERC7702Delegation(
  publicClient: PublicClient,
  account: Address,
  delegatorAddress: Address,
): Promise<boolean> {
  const code = await publicClient.getCode({ address: account });
  if (!code) {
    return false;
  }

  // Check if code matches EIP-7702 delegation pattern: 0xef0100 || delegator_address
  const expectedCode = `0xef0100${delegatorAddress.slice(2)}`;
  return code.toLowerCase() === expectedCode.toLowerCase();
}

/**
 * Execute batch of operations via EIP-7702 delegator
 */
export async function executeBatch(options: ExecuteBatchOptions, logger: Logger = noopLogger): Promise<Hex> {
  const { walletClient, publicClient, environmentConfig, executions, pendingMessage, gas } =
    options;

  const account = walletClient.account;
  if (!account) {
    throw new Error("Wallet client must have an account");
  }

  const chain = walletClient.chain;
  if (!chain) {
    throw new Error("Wallet client must have a chain");
  }

  const executeBatchData = encodeExecuteBatchData(executions);

  // Check if account is delegated
  const isDelegated = await checkERC7702Delegation(
    publicClient,
    account.address,
    environmentConfig.erc7702DelegatorAddress as Address,
  );

  // 4. Create authorization if needed
  let authorizationList: Array<SignAuthorizationReturnType> = [];

  if (!isDelegated) {
    const transactionNonce = await publicClient.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    });

    const chainId = await publicClient.getChainId();
    const authorizationNonce = transactionNonce + 1;

    logger.debug("Using wallet client signing for EIP-7702 authorization");

    const signedAuthorization = await walletClient.signAuthorization({
      account,
      contractAddress: environmentConfig.erc7702DelegatorAddress as Address,
      chainId: chainId,
      nonce: Number(authorizationNonce),
    });

    authorizationList = [signedAuthorization];
  }

  // 5. Show pending message
  if (pendingMessage) {
    logger.info(pendingMessage);
  }

  const txRequest: SendTransactionParameters = {
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
  if (gas?.gasLimit) {
    txRequest.gas = gas.gasLimit;
  }
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
