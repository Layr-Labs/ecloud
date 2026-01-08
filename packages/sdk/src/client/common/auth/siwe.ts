/**
 * SIWE (Sign-In with Ethereum) utilities for compute API authentication
 *
 * This module provides browser-safe utilities for creating and parsing SIWE messages
 * compatible with the compute-tee API.
 */

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

export interface SiweMessage {
  /** Raw SIWE message string for signing */
  message: string;
  /** Parsed parameters */
  params: Required<
    Pick<SiweMessageParams, "address" | "chainId" | "domain" | "uri" | "nonce" | "issuedAt">
  > &
    Omit<SiweMessageParams, "address" | "chainId" | "domain" | "uri" | "nonce" | "issuedAt">;
}

/**
 * Generate a random nonce for SIWE messages
 */
export function generateNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  const randomValues = new Uint8Array(16);

  // Use crypto.getRandomValues if available (browser), otherwise fall back to Math.random
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(randomValues);
    for (let i = 0; i < 16; i++) {
      nonce += chars[randomValues[i] % chars.length];
    }
  } else {
    for (let i = 0; i < 16; i++) {
      nonce += chars[Math.floor(Math.random() * chars.length)];
    }
  }

  return nonce;
}

/**
 * Format a date to ISO 8601 string for SIWE
 */
function formatDate(date: Date): string {
  return date.toISOString();
}

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
export function createSiweMessage(params: SiweMessageParams): SiweMessage {
  const now = new Date();
  const nonce = params.nonce || generateNonce();
  const issuedAt = params.issuedAt || now;
  const expirationTime = params.expirationTime || new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

  // Build the SIWE message according to EIP-4361 format
  // https://eips.ethereum.org/EIPS/eip-4361
  const lines: string[] = [];

  // Line 1: {domain} wants you to sign in with your Ethereum account:
  lines.push(`${params.domain} wants you to sign in with your Ethereum account:`);

  // Line 2: {address}
  lines.push(params.address);

  // Line 3: Empty line before statement (if statement exists)
  if (params.statement) {
    lines.push("");
    lines.push(params.statement);
  }

  // Empty line before fields
  lines.push("");

  // Required fields
  lines.push(`URI: ${params.uri}`);
  lines.push(`Version: 1`);
  lines.push(`Chain ID: ${params.chainId}`);
  lines.push(`Nonce: ${nonce}`);
  lines.push(`Issued At: ${formatDate(issuedAt)}`);

  // Optional fields
  if (expirationTime) {
    lines.push(`Expiration Time: ${formatDate(expirationTime)}`);
  }

  if (params.notBefore) {
    lines.push(`Not Before: ${formatDate(params.notBefore)}`);
  }

  if (params.requestId) {
    lines.push(`Request ID: ${params.requestId}`);
  }

  if (params.resources && params.resources.length > 0) {
    lines.push(`Resources:`);
    for (const resource of params.resources) {
      lines.push(`- ${resource}`);
    }
  }

  const message = lines.join("\n");

  return {
    message,
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
    const lines = message.split("\n");

    // Parse domain from first line
    const domainMatch = lines[0]?.match(/^(.+) wants you to sign in with your Ethereum account:$/);
    if (!domainMatch) return null;
    const domain = domainMatch[1];

    // Parse address from second line
    const address = lines[1] as Address;
    if (!address || !address.startsWith("0x")) return null;

    // Find the empty line that separates statement from fields
    let fieldStartIndex = 2;
    let statement: string | undefined;

    // Check for statement (appears after empty line, before fields)
    if (lines[2] === "") {
      // There's a statement section
      const fieldLineIndex = lines.findIndex((line, i) => i > 2 && line.startsWith("URI:"));
      if (fieldLineIndex > 3) {
        statement = lines.slice(3, fieldLineIndex - 1).join("\n");
        fieldStartIndex = fieldLineIndex;
      } else if (fieldLineIndex === 3) {
        fieldStartIndex = 3;
      }
    }

    // Parse fields
    const fields: Record<string, string> = {};
    const resources: string[] = [];
    let inResources = false;

    for (let i = fieldStartIndex; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      if (line === "Resources:") {
        inResources = true;
        continue;
      }

      if (inResources && line.startsWith("- ")) {
        resources.push(line.slice(2));
        continue;
      }

      const colonIndex = line.indexOf(": ");
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex);
        const value = line.slice(colonIndex + 2);
        fields[key] = value;
      }
    }

    const params: SiweMessageParams = {
      address,
      domain,
      uri: fields["URI"] || "",
      chainId: parseInt(fields["Chain ID"] || "0", 10),
      nonce: fields["Nonce"],
      statement,
    };

    if (fields["Issued At"]) {
      params.issuedAt = new Date(fields["Issued At"]);
    }

    if (fields["Expiration Time"]) {
      params.expirationTime = new Date(fields["Expiration Time"]);
    }

    if (fields["Not Before"]) {
      params.notBefore = new Date(fields["Not Before"]);
    }

    if (fields["Request ID"]) {
      params.requestId = fields["Request ID"];
    }

    if (resources.length > 0) {
      params.resources = resources;
    }

    return params;
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
