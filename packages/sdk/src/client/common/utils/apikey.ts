/**
 * API Key generation utilities for EigenAI
 *
 * Generates API keys similar to OpenAI's format:
 * - sk-{64 hex characters from 32 random bytes}
 */

import { keccak256, stringToHex } from "viem";
import { randomBytes } from "crypto";

export interface GeneratedApiKey {
  /** The API key in format "sk-{hex}" - must be saved, only shown once */
  apiKey: string;
  /** Keccak256 hash of the API key (hex string with 0x prefix) */
  apiKeyHash: string;
}

/**
 * Generates a cryptographically secure API key with format "sk-{64 hex chars}"
 * and returns both the key and its keccak256 hash.
 *
 * @returns The generated API key and its hash
 */
export function generateApiKey(): GeneratedApiKey {
  // Generate 32 bytes of cryptographically secure randomness
  const bytes = randomBytes(32);

  // Create API key with "sk-" prefix (similar to OpenAI's convention)
  const apiKey = `sk-${bytes.toString("hex")}`;

  // Hash the API key using keccak256
  const apiKeyHash = keccak256(stringToHex(apiKey));

  return { apiKey, apiKeyHash };
}
