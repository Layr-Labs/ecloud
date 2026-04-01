/**
 * SIWE (Sign-In with Ethereum) utilities for compute API authentication
 *
 * This module provides browser-safe utilities for creating and parsing SIWE messages
 * compatible with the compute-tee API. Uses the official `siwe` package (EIP-4361).
 */

import { SiweMessage, generateNonce as siweGenerateNonce } from "siwe";
import { Address } from "viem";

export interface SiweMessageParams {
  /** Ethereum address (checksummed or lowercase) */
  address: Address;
  /** Chain ID (e.g., 1 for mainnet, 11155111 for sepolia) */
  chainId: number;
  /** Domain requesting the signature (e.g., "api.eigencloud.xyz") */
  domain: string;
  /** Full URI of the signing request (e.g., "https://api.eigencloud.xyz") */
  uri: string;
  /** Optional nonce for replay protection (generated if not provided) */
  nonce?: string;
  /** Optional human-readable statement */
  statement?: string;
  /** Optional expiration time (defaults to 24 hours from now) */
  expirationTime?: Date;
  /** Optional issued at time (defaults to now) */
  issuedAt?: Date;
  /** Optional not-before time */
  notBefore?: Date;
  /** Optional request ID */
  requestId?: string;
  /** Optional resources array */
  resources?: string[];
}

export interface SiweMessageResult {
  /** Raw SIWE message string for signing */
  message: string;
  /** Parsed parameters */
  params: Required<
    Pick<SiweMessageParams, "address" | "chainId" | "domain" | "uri" | "nonce" | "issuedAt">
  > &
    Omit<SiweMessageParams, "address" | "chainId" | "domain" | "uri" | "nonce" | "issuedAt">;
}

/**
 * Re-export generateNonce from siwe package
 */
export const generateNonce = siweGenerateNonce;

/**
 * Create a SIWE message for compute API authentication
 *
 * @param params - Parameters for the SIWE message
 * @returns The SIWE message object with the raw message string
 *
 * @example
 * ```typescript
 * const { message } = createSiweMessage({
 *   address: "0x1234...",
 *   chainId: 11155111,
 *   domain: "api.eigencloud.xyz",
 *   uri: "https://api.eigencloud.xyz",
 *   statement: "Sign in to EigenCloud",
 * });
 *
 * // Sign with wagmi
 * const signature = await signMessageAsync({ message });
 * ```
 */
export function createSiweMessage(params: SiweMessageParams): SiweMessageResult {
  const now = new Date();
  const nonce = params.nonce || generateNonce();
  const issuedAt = params.issuedAt || now;
  const expirationTime = params.expirationTime || new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

  // Create SIWE message using the official package
  const siweMessage = new SiweMessage({
    domain: params.domain,
    address: params.address,
    statement: params.statement,
    uri: params.uri,
    version: "1",
    chainId: params.chainId,
    nonce,
    issuedAt: issuedAt.toISOString(),
    expirationTime: expirationTime.toISOString(),
    notBefore: params.notBefore?.toISOString(),
    requestId: params.requestId,
    resources: params.resources,
  });

  return {
    message: siweMessage.prepareMessage(),
    params: {
      address: params.address,
      chainId: params.chainId,
      domain: params.domain,
      uri: params.uri,
      nonce,
      issuedAt,
      statement: params.statement,
      expirationTime,
      notBefore: params.notBefore,
      requestId: params.requestId,
      resources: params.resources,
    },
  };
}

/**
 * Parse a SIWE message string back to structured parameters
 *
 * @param message - Raw SIWE message string
 * @returns Parsed parameters or null if invalid
 */
export function parseSiweMessage(message: string): SiweMessageParams | null {
  try {
    const siweMessage = new SiweMessage(message);

    return {
      address: siweMessage.address as Address,
      chainId: siweMessage.chainId,
      domain: siweMessage.domain,
      uri: siweMessage.uri,
      nonce: siweMessage.nonce,
      statement: siweMessage.statement,
      issuedAt: siweMessage.issuedAt ? new Date(siweMessage.issuedAt) : undefined,
      expirationTime: siweMessage.expirationTime ? new Date(siweMessage.expirationTime) : undefined,
      notBefore: siweMessage.notBefore ? new Date(siweMessage.notBefore) : undefined,
      requestId: siweMessage.requestId,
      resources: siweMessage.resources,
    };
  } catch {
    return null;
  }
}

/**
 * Check if a SIWE message has expired
 */
export function isSiweMessageExpired(params: SiweMessageParams): boolean {
  if (!params.expirationTime) return false;
  return new Date() > params.expirationTime;
}

/**
 * Check if a SIWE message is not yet valid (notBefore)
 */
export function isSiweMessageNotYetValid(params: SiweMessageParams): boolean {
  if (!params.notBefore) return false;
  return new Date() < params.notBefore;
}
