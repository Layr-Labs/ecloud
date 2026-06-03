/**
 * Safe Transaction Service integration
 *
 * Proposes transactions to a Gnosis Safe via the Safe Transaction Service API.
 * The EOA signs the transaction hash and submits the proposal. Other Safe owners
 * approve it externally (e.g., at app.safe.global).
 */

import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  encodePacked,
  keccak256,
  encodeFunctionData,
  parseAbi,
  zeroAddress,
} from "viem";

// Minimal Safe ABI for reading state
const SafeABI = parseAbi([
  "function nonce() view returns (uint256)",
  "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)",
  "function getThreshold() view returns (uint256)",
  "function getOwners() view returns (address[])",
]);

export interface ProposeSafeTransactionOptions {
  walletClient: WalletClient;
  publicClient: PublicClient;
  safeAddress: Address;
  to: Address;
  data: Hex;
  value?: bigint;
  environment: string;
}

export interface SafeProposalResult {
  safeTxHash: string;
  safeAddress: string;
  proposer: string;
  safeUrl: string;
}

/**
 * Get the Safe Transaction Service URL for the given environment
 */
function getSafeServiceUrl(environment: string): string {
  if (environment === "mainnet-alpha") {
    return "https://safe-transaction-mainnet.safe.global";
  }
  return "https://safe-transaction-sepolia.safe.global";
}

/**
 * Propose a transaction to a Gnosis Safe via the Transaction Service.
 *
 * The EOA signs the Safe transaction hash and posts the proposal.
 * Other signers approve at app.safe.global or via the Safe API.
 *
 * Returns the Safe transaction hash and a URL to track approval.
 */
export async function proposeSafeTransaction(
  options: ProposeSafeTransactionOptions,
): Promise<SafeProposalResult> {
  const {
    walletClient,
    publicClient,
    safeAddress,
    to,
    data,
    value = 0n,
    environment,
  } = options;

  const account = walletClient.account;
  if (!account) {
    throw new Error("WalletClient must have an account attached");
  }

  // Read Safe nonce
  const nonce = await publicClient.readContract({
    address: safeAddress,
    abi: SafeABI,
    functionName: "nonce",
  });

  // Get the Safe transaction hash (EIP-712 typed hash)
  const safeTxHash = await publicClient.readContract({
    address: safeAddress,
    abi: SafeABI,
    functionName: "getTransactionHash",
    args: [
      to,           // to
      value,        // value
      data,         // data
      0,            // operation (0 = Call)
      0n,           // safeTxGas
      0n,           // baseGas
      0n,           // gasPrice
      zeroAddress,  // gasToken
      zeroAddress,  // refundReceiver
      nonce,        // nonce
    ],
  }) as Hex;

  // Sign the hash with the EOA
  const signature = await walletClient.signMessage({
    account,
    message: { raw: safeTxHash },
  });

  // Adjust signature: Safe expects v = v + 4 for eth_sign signatures
  const sigBytes = Buffer.from(signature.slice(2), "hex");
  const v = sigBytes[sigBytes.length - 1];
  sigBytes[sigBytes.length - 1] = v + 4;
  const adjustedSignature = ("0x" + sigBytes.toString("hex")) as Hex;

  // Post to Safe Transaction Service
  const serviceUrl = getSafeServiceUrl(environment);
  const endpoint = `${serviceUrl}/api/v1/safes/${safeAddress}/multisig-transactions/`;

  const body = {
    to,
    value: value.toString(),
    data,
    operation: 0,
    safeTxGas: "0",
    baseGas: "0",
    gasPrice: "0",
    gasToken: zeroAddress,
    refundReceiver: zeroAddress,
    nonce: Number(nonce),
    contractTransactionHash: safeTxHash,
    sender: account.address,
    signature: adjustedSignature,
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Safe Transaction Service error (${response.status}): ${text}`);
  }

  const chainPrefix = environment === "mainnet-alpha" ? "eth" : "sep";
  const safeUrl = `https://app.safe.global/transactions/queue?safe=${chainPrefix}:${safeAddress}`;

  return {
    safeTxHash: safeTxHash as string,
    safeAddress: safeAddress as string,
    proposer: account.address as string,
    safeUrl,
  };
}
