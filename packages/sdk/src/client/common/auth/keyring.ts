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

// eigenx-cli keyring identifiers (for legacy key detection)
const EIGENX_SERVICE_NAME = "eigenx-cli";
const EIGENX_DEV_SERVICE_NAME = "eigenx-cli-dev";
const EIGENX_ACCOUNT_PREFIX = "eigenx-"; // eigenx-cli prefixes account names

// go-keyring encoding constants (used by eigenx-cli on macOS)
const GO_KEYRING_BASE64_PREFIX = "go-keyring-base64:";
const GO_KEYRING_ENCODED_PREFIX = "go-keyring-encoded:"; // legacy hex encoding

export interface StoredKey {
  address: string;
}

export interface LegacyKey {
  environment: string;
  address: string;
  source: "eigenx" | "eigenx-dev";
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
  const isValid = validatePrivateKey(normalizedKey);
  if (!isValid) {
    throw new Error("Invalid private key format");
  }

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
        const address = getAddressFromPrivateKey(
          cred.password as `0x${string}`
        );
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
 * Get legacy keys from eigenx-cli
 * Returns an array of keys found in eigenx-cli keyring formats
 */
export async function getLegacyKeys(): Promise<LegacyKey[]> {
  const keys: LegacyKey[] = [];

  // 1. Check eigenx-cli production keys
  try {
    const eigenxCreds = findCredentials(EIGENX_SERVICE_NAME);
    for (const cred of eigenxCreds) {
      // eigenx-cli stores keys with account name "eigenx-<environment>"
      // Strip the prefix to get the environment name
      const accountName = cred.account;
      if (!accountName.startsWith(EIGENX_ACCOUNT_PREFIX)) {
        continue; // Skip if it doesn't have the expected prefix
      }
      const environment = accountName.substring(EIGENX_ACCOUNT_PREFIX.length);

      try {
        // Decode go-keyring encoding (used on macOS)
        const decodedKey = decodeGoKeyringValue(cred.password);
        const address = getAddressFromPrivateKey(decodedKey as `0x${string}`);
        keys.push({ environment, address, source: "eigenx" });
      } catch (err) {
        console.warn(
          `Warning: Invalid key found for ${environment} (eigenx-cli), skipping: ${err}`
        );
      }
    }
  } catch {
    // eigenx-cli service not found, that's ok
  }

  // 2. Check eigenx-cli dev keys
  try {
    const eigenxDevCreds = findCredentials(EIGENX_DEV_SERVICE_NAME);
    for (const cred of eigenxDevCreds) {
      // eigenx-cli stores keys with account name "eigenx-<environment>"
      // Strip the prefix to get the environment name
      const accountName = cred.account;
      if (!accountName.startsWith(EIGENX_ACCOUNT_PREFIX)) {
        continue; // Skip if it doesn't have the expected prefix
      }
      const environment = accountName.substring(EIGENX_ACCOUNT_PREFIX.length);

      try {
        // Decode go-keyring encoding (used on macOS)
        const decodedKey = decodeGoKeyringValue(cred.password);
        const address = getAddressFromPrivateKey(decodedKey as `0x${string}`);
        keys.push({ environment, address, source: "eigenx-dev" });
      } catch (err) {
        console.warn(
          `Warning: Invalid key found for ${environment} (eigenx-dev), skipping: ${err}`
        );
      }
    }
  } catch {
    // eigenx-dev service not found, that's ok
  }

  return keys;
}

/**
 * Get a specific legacy private key from eigenx-cli keyring
 */
export async function getLegacyPrivateKey(
  environment: string,
  source: "eigenx" | "eigenx-dev"
): Promise<string | null> {
  const serviceName =
    source === "eigenx" ? EIGENX_SERVICE_NAME : EIGENX_DEV_SERVICE_NAME;

  // eigenx-cli stores keys with account name "eigenx-<environment>"
  const accountName = EIGENX_ACCOUNT_PREFIX + environment;

  const entry = new AsyncEntry(serviceName, accountName);
  try {
    const rawKey = await entry.getPassword();
    if (rawKey) {
      // Decode go-keyring encoding (used on macOS)
      const decodedKey = decodeGoKeyringValue(rawKey);
      if (validatePrivateKey(decodedKey)) {
        return decodedKey;
      }
    }
  } catch {
    // Key not found
  }

  return null;
}

/**
 * Delete a specific legacy private key from eigenx-cli keyring
 * Returns true if deletion was successful, false otherwise
 */
export async function deleteLegacyPrivateKey(
  environment: string,
  source: "eigenx" | "eigenx-dev"
): Promise<boolean> {
  const serviceName =
    source === "eigenx" ? EIGENX_SERVICE_NAME : EIGENX_DEV_SERVICE_NAME;

  // eigenx-cli stores keys with account name "eigenx-<environment>"
  const accountName = EIGENX_ACCOUNT_PREFIX + environment;

  const entry = new AsyncEntry(serviceName, accountName);
  try {
    await entry.deletePassword();
    return true;
  } catch {
    console.warn(`No key found for ${environment} in ${source}`);
    return false;
  }
}

/**
 * Validate private key format
 */
export function validatePrivateKey(privateKey: string): boolean {
  try {
    getAddressFromPrivateKey(privateKey);
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
 * Decode go-keyring encoded values
 *
 * go-keyring (used by eigenx-cli) stores values with special encoding on macOS:
 * - "go-keyring-base64:" prefix + base64-encoded value
 * - "go-keyring-encoded:" prefix + hex-encoded value (legacy)
 *
 * This function detects and decodes these formats.
 */
function decodeGoKeyringValue(rawValue: string): string {
  // Check for base64 encoding (primary format)
  if (rawValue.startsWith(GO_KEYRING_BASE64_PREFIX)) {
    const encoded = rawValue.substring(GO_KEYRING_BASE64_PREFIX.length);
    try {
      // Decode base64
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      return decoded;
    } catch (err) {
      console.warn(`Warning: Failed to decode go-keyring base64 value: ${err}`);
      return rawValue; // Return as-is if decoding fails
    }
  }

  // Check for hex encoding (legacy format)
  if (rawValue.startsWith(GO_KEYRING_ENCODED_PREFIX)) {
    const encoded = rawValue.substring(GO_KEYRING_ENCODED_PREFIX.length);
    try {
      // Decode hex
      const decoded = Buffer.from(encoded, "hex").toString("utf8");
      return decoded;
    } catch (err) {
      console.warn(`Warning: Failed to decode go-keyring hex value: ${err}`);
      return rawValue; // Return as-is if decoding fails
    }
  }

  // No encoding detected, return as-is
  return rawValue;
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
