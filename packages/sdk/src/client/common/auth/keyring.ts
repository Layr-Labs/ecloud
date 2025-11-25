/**
 * OS Keyring Integration
 *
 * Provides secure storage for private keys using native OS keychains:
 * - macOS: Keychain
 * - Linux: Secret Service API (libsecret/gnome-keyring)
 * - Windows: Credential Manager
 *
 * Uses a single key for all environments.
 */

import { AsyncEntry, findCredentials } from "@napi-rs/keyring";
import { privateKeyToAddress } from "viem/accounts";

// ecloud keyring identifiers
const SERVICE_NAME = "ecloud";
const ACCOUNT_NAME = "key"; // Single key for all environments

export interface StoredKey {
  address: string;
}

/**
 * Store a private key in OS keyring
 *
 * Note: Stores a single key for all environments.
 * The environment parameter is kept for API compatibility but is ignored.
 */
export async function storePrivateKey(privateKey: string): Promise<void> {
  // Validate private key format
  const normalizedKey = normalizePrivateKey(privateKey);

  // Validate by deriving address (will throw if invalid)
  privateKeyToAddress(normalizedKey);

  // Store in single-key format
  const entry = new AsyncEntry(SERVICE_NAME, ACCOUNT_NAME);
  try {
    await entry.setPassword(normalizedKey);
  } catch (err: any) {
    throw new Error(
      `Failed to store key in OS keyring: ${err?.message ?? err}. Ensure keyring service is available.`
    );
  }
}

/**
 * Get a private key from OS keyring
 *
 * Note: Returns the single stored key for all environments.
 * The environment parameter is kept for API compatibility but is ignored.
 */
export async function getPrivateKey(): Promise<string | null> {
  const entry = new AsyncEntry(SERVICE_NAME, ACCOUNT_NAME);
  try {
    const key = await entry.getPassword();
    if (key && validatePrivateKey(key)) {
      return key;
    }
  } catch {
    // Key not found
  }

  return null;
}

/**
 * Delete a private key from OS keyring
 * Returns true if deletion was successful, false otherwise
 *
 * Note: Deletes the single stored key.
 * The environment parameter is kept for API compatibility but is ignored.
 */
export async function deletePrivateKey(): Promise<boolean> {
  const entry = new AsyncEntry(SERVICE_NAME, ACCOUNT_NAME);
  try {
    await entry.deletePassword();
    return true;
  } catch {
    console.warn("No key found in keyring");
    return false;
  }
}

/**
 * List all stored keys
 * Returns an array with the single stored key (if it exists)
 */
export async function listStoredKeys(): Promise<StoredKey[]> {
  const keys: StoredKey[] = [];

  const creds = findCredentials(SERVICE_NAME);
  for (const cred of creds) {
    if (cred.account === ACCOUNT_NAME) {
      try {
        const address = privateKeyToAddress(cred.password as `0x${string}`);
        keys.push({ address });
      } catch (err) {
        console.warn(`Warning: Invalid key found, skipping: ${err}`);
      }
    }
  }

  return keys;
}

/**
 * Check if a key exists
 *
 * Note: Checks for the single stored key.
 * The environment parameter is kept for API compatibility but is ignored.
 */
export async function keyExists(): Promise<boolean> {
  const key = await getPrivateKey();
  return key !== null;
}

/**
 * Validate private key format
 */
export function validatePrivateKey(privateKey: string): boolean {
  try {
    const normalized = normalizePrivateKey(privateKey);
    privateKeyToAddress(normalized);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get address from private key
 */
export function getAddressFromPrivateKey(privateKey: string): string {
  const normalized = normalizePrivateKey(privateKey);
  return privateKeyToAddress(normalized);
}

/**
 * Normalize private key (ensure 0x prefix)
 */
function normalizePrivateKey(privateKey: string): `0x${string}` {
  if (!privateKey.startsWith("0x")) {
    return `0x${privateKey}` as `0x${string}`;
  }
  return privateKey as `0x${string}`;
}
