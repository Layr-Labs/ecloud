/**
 * Shared authentication utilities for API clients
 *
 * Supports two modes:
 * 1. Private key mode: Use account from privateKeyToAccount
 * 2. WithSigner mode: Use signMessage callback from external signer (wallet, etc.)
 */

import { Hex, parseAbi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, type PublicClient } from "viem";

// Minimal AppController ABI for permission calculation
const APP_CONTROLLER_ABI = parseAbi([
  "function calculateApiPermissionDigestHash(bytes4 permission, uint256 expiry) view returns (bytes32)",
]);

export interface PermissionSignatureOptions {
  permission: Hex;
  expiry: bigint;
  appControllerAddress: Address;
  publicClient: ReturnType<typeof createPublicClient>;
  account: ReturnType<typeof privateKeyToAccount>;
}

/**
 * WithSigner mode options - use signMessage callback instead of account
 */
export interface PermissionSignatureWithSignerOptions {
  permission: Hex;
  expiry: bigint;
  appControllerAddress: Address;
  publicClient: PublicClient;
  signMessage: (message: { raw: Hex }) => Promise<Hex>;
}

export interface PermissionSignatureResult {
  signature: string;
  digest: Hex;
}

/**
 * Calculate permission digest via AppController contract and sign it with EIP-191
 * Private key mode - uses account from privateKeyToAccount
 */
export async function calculatePermissionSignature(
  options: PermissionSignatureOptions,
): Promise<PermissionSignatureResult> {
  const { permission, expiry, appControllerAddress, publicClient, account } = options;

  // Calculate permission digest hash using AppController contract
  const digest = (await publicClient.readContract({
    address: appControllerAddress,
    abi: APP_CONTROLLER_ABI,
    functionName: "calculateApiPermissionDigestHash",
    args: [permission, expiry],
  })) as Hex;

  // Sign the digest using EIP-191 (signMessage handles prefixing automatically)
  const signature = await account.signMessage({
    message: { raw: digest },
  });

  return { signature, digest };
}

/**
 * Calculate permission digest via AppController contract and sign it with EIP-191
 * WithSigner mode - uses signMessage callback from external signer
 */
export async function calculatePermissionSignatureWithSigner(
  options: PermissionSignatureWithSignerOptions,
): Promise<PermissionSignatureResult> {
  const { permission, expiry, appControllerAddress, publicClient, signMessage } = options;

  // Calculate permission digest hash using AppController contract
  const digest = (await publicClient.readContract({
    address: appControllerAddress,
    abi: APP_CONTROLLER_ABI,
    functionName: "calculateApiPermissionDigestHash",
    args: [permission, expiry],
  })) as Hex;

  // Sign the digest using the provided signMessage callback
  // This will trigger the wallet's signing UI (MetaMask, etc.)
  const signature = await signMessage({ raw: digest });

  return { signature, digest };
}

export interface BillingAuthSignatureOptions {
  account: ReturnType<typeof privateKeyToAccount>;
  product: string;
  expiry: bigint;
}

/**
 * WithSigner mode options for billing auth - uses signTypedData callback
 */
export interface BillingAuthSignatureWithSignerOptions {
  signTypedData: (params: {
    domain: {
      name: string;
      version: string;
    };
    types: {
      BillingAuth: Array<{ name: string; type: string }>;
    };
    primaryType: "BillingAuth";
    message: {
      product: string;
      expiry: bigint;
    };
  }) => Promise<Hex>;
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
 * Private key mode - uses account from privateKeyToAccount
 */
export async function calculateBillingAuthSignature(
  options: BillingAuthSignatureOptions,
): Promise<BillingAuthSignatureResult> {
  const { account, product, expiry } = options;

  // Sign using EIP-712 typed data
  const signature = await account.signTypedData(generateBillingSigData(product, expiry));

  return { signature, expiry };
}

/**
 * Sign billing authentication message using EIP-712 typed data
 * WithSigner mode - uses signTypedData callback from external signer
 */
export async function calculateBillingAuthSignatureWithSigner(
  options: BillingAuthSignatureWithSignerOptions,
): Promise<BillingAuthSignatureResult> {
  const { signTypedData, product, expiry } = options;

  // Sign using EIP-712 typed data via wallet client
  // This will trigger the wallet's signing UI (MetaMask, etc.)
  const signature = await signTypedData(generateBillingSigData(product, expiry));

  return { signature, expiry };
}

export interface BuildAuthSignatureOptions {
  account: ReturnType<typeof privateKeyToAccount>;
  expiry: bigint;
}

export interface BuildAuthSignatureResult {
  signature: Hex;
  expiry: bigint;
}

/**
 * Sign build authentication message using EIP-712 typed data
 */
export async function calculateBuildAuthSignature(
  options: BuildAuthSignatureOptions,
): Promise<BuildAuthSignatureResult> {
  const { account, expiry } = options;

  const signature = await account.signTypedData({
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
