/**
 * Private Key Resolution
 *
 * Implements 3-tier priority system for private key retrieval:
 * 1. Command-line flag (--private-key)
 * 2. Environment variable (ECLOUD_PRIVATE_KEY)
 * 3. OS keyring (stored via `ecloud auth login`)
 */

import { getPrivateKey, validatePrivateKey } from "./keyring";

export interface PrivateKeySource {
  key: string;
  source: string;
}

/**
 * Get private key from any available source
 *
 * Priority order:
 * 1. Direct parameter (from --private-key flag)
 * 2. Environment variable (ECLOUD_PRIVATE_KEY)
 * 3. OS keyring (single key for all environments)
 *
 * Returns null if no key found
 */
export async function getPrivateKeyWithSource(options: {
  privateKey?: string; // From flag
}): Promise<PrivateKeySource | null> {
  // 1. Check direct parameter (flag)
  if (options.privateKey) {
    if (!validatePrivateKey(options.privateKey)) {
      throw new Error(
        "Invalid private key format provided via command flag. Please check and try again."
      );
    }
    return {
      key: options.privateKey,
      source: "command flag",
    };
  }

  // 2. Check environment variable
  const envKey = process.env.ECLOUD_PRIVATE_KEY;
  if (envKey) {
    if (!validatePrivateKey(envKey)) {
      throw new Error(
        "Invalid private key format provided via environment variable. Please check and try again."
      );
    }
    return {
      key: envKey,
      source: "environment variable (ECLOUD_PRIVATE_KEY)",
    };
  }

  // 3. Check OS keyring (single key for all environments)
  const keyringKey = await getPrivateKey();
  if (keyringKey) {
    return {
      key: keyringKey,
      source: "stored credentials",
    };
  }

  return null;
}

/**
 * Get private key with source or throw error
 */
export async function requirePrivateKey(options: {
  privateKey?: string;
}): Promise<PrivateKeySource> {
  const result = await getPrivateKeyWithSource({
    privateKey: options.privateKey,
  });

  if (!result) {
    throw new Error(
      `Private key required. Please provide it via:\n` +
        `  • Keyring: ecloud auth login\n` +
        `  • Flag: --private-key YOUR_KEY\n` +
        `  • Environment: export ECLOUD_PRIVATE_KEY=YOUR_KEY`
    );
  }

  return result;
}
