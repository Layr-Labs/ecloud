/**
 * Shared authentication utilities for API clients
 *
 * Uses viem's WalletClient which abstracts over both local accounts (privateKeyToAccount)
 * and external signers (MetaMask, etc.)
 */

import { Hex, parseAbi, type Address, type PublicClient, type WalletClient } from "viem";

// Minimal AppController ABI for permission calculation
const APP_CONTROLLER_ABI = parseAbi([
  "function calculateApiPermissionDigestHash(bytes4 permission, uint256 expiry) view returns (bytes32)",
]);

export interface PermissionSignatureOptions {
  permission: Hex;
  expiry: bigint;
  appControllerAddress: Address;
  publicClient: PublicClient;
  walletClient: WalletClient;
}

export interface PermissionSignatureResult {
  signature: string;
  digest: Hex;
}

/**
 * Calculate permission digest via AppController contract and sign it with EIP-191
 *
 * Works with any WalletClient - whether backed by a local private key or external signer.
 */
export async function calculatePermissionSignature(
  options: PermissionSignatureOptions,
): Promise<PermissionSignatureResult> {
  const { permission, expiry, appControllerAddress, publicClient, walletClient } = options;

  // Calculate permission digest hash using AppController contract
  const digest = (await publicClient.readContract({
    address: appControllerAddress,
    abi: APP_CONTROLLER_ABI,
    functionName: "calculateApiPermissionDigestHash",
    args: [permission, expiry],
  })) as Hex;

  // Get account from wallet client
  const account = walletClient.account;
  if (!account) {
    throw new Error("WalletClient must have an account attached");
  }

  // Sign the digest using EIP-191 (signMessage handles prefixing automatically)
  const signature = await walletClient.signMessage({
    account,
    message: { raw: digest },
  });

  return { signature, digest };
}

export interface BillingAuthSignatureOptions {
  walletClient: WalletClient;
  product: string;
  expiry: bigint;
}

export interface BillingAuthSignatureResult {
  signature: Hex;
  expiry: bigint;
}

const generateBillingSigData = (product: string, expiry: bigint) => {
  return {
    domain: {
      name: "EigenCloud Billing API",
      version: "1",
    },
    types: {
      BillingAuth: [
        { name: "product", type: "string" },
        { name: "expiry", type: "uint256" },
      ],
    },
    primaryType: "BillingAuth" as const,
    message: {
      product,
      expiry,
    },
  };
};

/**
 * Sign billing authentication message using EIP-712 typed data
 *
 * Works with any WalletClient - whether backed by a local private key or external signer.
 */
export async function calculateBillingAuthSignature(
  options: BillingAuthSignatureOptions,
): Promise<BillingAuthSignatureResult> {
  const { walletClient, product, expiry } = options;

  // Get account from wallet client
  const account = walletClient.account;
  if (!account) {
    throw new Error("WalletClient must have an account attached");
  }

  // Sign using EIP-712 typed data
  const signature = await walletClient.signTypedData({
    account,
    ...generateBillingSigData(product, expiry),
  });

  return { signature, expiry };
}

export interface BuildAuthSignatureOptions {
  walletClient: WalletClient;
  expiry: bigint;
}

export interface BuildAuthSignatureResult {
  signature: Hex;
  expiry: bigint;
}

/**
 * Sign build authentication message using EIP-712 typed data
 *
 * Works with any WalletClient - whether backed by a local private key or external signer.
 */
export async function calculateBuildAuthSignature(
  options: BuildAuthSignatureOptions,
): Promise<BuildAuthSignatureResult> {
  const { walletClient, expiry } = options;

  // Get account from wallet client
  const account = walletClient.account;
  if (!account) {
    throw new Error("WalletClient must have an account attached");
  }

  const signature = await walletClient.signTypedData({
    account,
    domain: {
      name: "EigenCloud Build API",
      version: "1",
    },
    types: {
      BuildAuth: [{ name: "expiry", type: "uint256" }],
    },
    primaryType: "BuildAuth",
    message: {
      expiry,
    },
  });

  return { signature, expiry };
}
