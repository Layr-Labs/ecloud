/**
 * OS Keyring Integration
 *
 * Provides secure storage for private keys using native OS keychains:
 * - macOS: Keychain
 * - Linux: Secret Service API (libsecret/gnome-keyring)
 * - Windows: Credential Manager
 */

import { AsyncEntry, findCredentials } from "@napi-rs/keyring";
import { privateKeyToAddress } from "viem/accounts";

const KEY_PREFIX = "ecloud-";
const SERVICE_NAME = "ecloud";

export interface StoredKey {
  environment: string;
  address: string;
}

/**
 * Store a private key in OS keyring
 */
export async function storePrivateKey(
  environment: string,
  privateKey: string
): Promise<void> {
  // Validate private key format
  const normalizedKey = normalizePrivateKey(privateKey);

  // Validate by deriving address (will throw if invalid)
  privateKeyToAddress(normalizedKey);

  const account = KEY_PREFIX + environment;
  const entry = new AsyncEntry(SERVICE_NAME, account);
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
 */
export async function getPrivateKey(
  environment: string
): Promise<string | null> {
  const account = KEY_PREFIX + environment;
  const entry = new AsyncEntry(SERVICE_NAME, account);
  try {
    const key = await entry.getPassword();
    if (!key) {
      return null;
    }
    return key;
  } catch (err: any) {
    console.warn(
      `Failed to retrieve key from keyring for environment "${environment}": ${err?.message ?? err}`
    );
    return null;
  }
}

/**
 * Delete a private key from OS keyring
 * Returns true if deletion was successful, false otherwise
 */
export async function deletePrivateKey(environment: string): Promise<boolean> {
  const account = KEY_PREFIX + environment;
  const entry = new AsyncEntry(SERVICE_NAME, account);
  try {
    await entry.deletePassword();
    return true;
  } catch (err: any) {
    console.warn(
      `Failed to delete key from keyring for environment "${environment}": ${err?.message ?? err}`
    );
    return false;
  }
}

/**
 * List all stored keys
 * Returns an array of stored keys with environment and address
 */
export async function listStoredKeys(): Promise<StoredKey[]> {
  const credentials = findCredentials(SERVICE_NAME);
  const keys: StoredKey[] = [];

  for (const cred of credentials) {
    // Only include keys with our prefix
    if (cred.account.startsWith(KEY_PREFIX)) {
      const environment = cred.account.slice(KEY_PREFIX.length);

      try {
        // Derive address from stored key
        const address = privateKeyToAddress(cred.password as `0x${string}`);
        keys.push({ environment, address });
      } catch (err) {
        // Skip invalid keys (shouldn't happen, but be defensive)
        console.warn(
          `Warning: Invalid key found for ${environment}, skipping: ${err}`
        );
      }
    }
  }

  return keys;
}

/**
 * Check if a key exists for an environment
 */
export async function keyExists(environment: string): Promise<boolean> {
  const key = await getPrivateKey(environment);
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
