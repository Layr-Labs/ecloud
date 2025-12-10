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

type KeyMap = {
  [environment: string]: {
    [build: string]: {
      encryption: string;
      signing: string;
    };
  };
};

const KEYS: KeyMap = {
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
};

/**
 * Get KMS keys for environment
 */
export function getKMSKeysForEnvironment(
  environment: string,
  build: "dev" | "prod" = "prod",
): { encryptionKey: Buffer; signingKey: Buffer } {
  const envKeys = KEYS[environment];
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
export function keysExistForEnvironment(
  environment: string,
  build: "dev" | "prod" = "prod",
): boolean {
  return !!KEYS[environment]?.[build];
}
