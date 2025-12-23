/**
 * Shared authentication utilities for API clients
 */

import { Hex, parseAbi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient } from "viem";

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

export interface PermissionSignatureResult {
  signature: string;
  digest: Hex;
}

/**
 * Calculate permission digest via AppController contract and sign it with EIP-191
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

export interface BillingAuthSignatureOptions {
  account: ReturnType<typeof privateKeyToAccount>;
  product: string;
  expiry: bigint;
}

export interface BillingAuthSignatureResult {
  signature: Hex;
  expiry: bigint;
}

/**
 * Sign billing authentication message using EIP-712 typed data
 */
export async function calculateBillingAuthSignature(
  options: BillingAuthSignatureOptions,
): Promise<BillingAuthSignatureResult> {
  const { account, product, expiry } = options;

  // Sign using EIP-712 typed data
  const signature = await account.signTypedData({
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
    primaryType: "BillingAuth",
    message: {
      product,
      expiry,
    },
  });

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
