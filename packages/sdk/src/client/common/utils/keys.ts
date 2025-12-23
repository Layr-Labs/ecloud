/**
 * KMS key loading utilities
 */

// Import all keys at build time
import mainnetAlphaProdEncryption from "../../../../keys/mainnet-alpha/prod/kms-encryption-public-key.pem";
import mainnetAlphaProdSigning from "../../../../keys/mainnet-alpha/prod/kms-signing-public-key.pem";
import sepoliaDevEncryption from "../../../../keys/sepolia/dev/kms-encryption-public-key.pem";
import sepoliaDevSigning from "../../../../keys/sepolia/dev/kms-signing-public-key.pem";
import sepoliaProdEncryption from "../../../../keys/sepolia/prod/kms-encryption-public-key.pem";
import sepoliaProdSigning from "../../../../keys/sepolia/prod/kms-signing-public-key.pem";

type BuildType = "dev" | "prod";
type KeyPair = { encryption: string; signing: string };

const KEYS = {
  "mainnet-alpha": {
    prod: {
      encryption: mainnetAlphaProdEncryption,
      signing: mainnetAlphaProdSigning,
    },
  },
  sepolia: {
    dev: {
      encryption: sepoliaDevEncryption,
      signing: sepoliaDevSigning,
    },
    prod: {
      encryption: sepoliaProdEncryption,
      signing: sepoliaProdSigning,
    },
  },
} as const satisfies Record<string, Partial<Record<BuildType, KeyPair>>>;

/**
 * Get KMS keys for environment
 */
export function getKMSKeysForEnvironment(
  environment: string,
  build: BuildType = "prod",
): { encryptionKey: Buffer; signingKey: Buffer } {
  const envKeys = (KEYS as Record<string, Partial<Record<BuildType, KeyPair>>>)[environment];
  if (!envKeys) {
    throw new Error(`No keys found for environment: ${environment}`);
  }

  const buildKeys = envKeys[build];
  if (!buildKeys) {
    throw new Error(`No keys found for environment: ${environment}, build: ${build}`);
  }

  return {
    encryptionKey: Buffer.from(buildKeys.encryption),
    signingKey: Buffer.from(buildKeys.signing),
  };
}

/**
 * Check if keys exist for environment
 */
export function keysExistForEnvironment(environment: string, build: BuildType = "prod"): boolean {
  const envKeys = (KEYS as Record<string, Partial<Record<BuildType, KeyPair>>>)[environment];
  if (!envKeys) return false;
  return !!envKeys[build];
}
