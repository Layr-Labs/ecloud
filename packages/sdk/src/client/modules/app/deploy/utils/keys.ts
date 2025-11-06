/**
 * KMS key loading utilities
 */

import * as fs from 'fs';
import * as path from 'path';
import { getDirname } from './dirname';

const __dirname = getDirname();
const KEYS_BASE_PATH = path.join(__dirname, '../../keys');

/**
 * Get KMS keys for environment
 */
export function getKMSKeysForEnvironment(
  environment: string,
  build: 'dev' | 'prod' = 'dev'
): { encryptionKey: Buffer; signingKey: Buffer } {
  const encryptionPath = path.join(
    KEYS_BASE_PATH,
    environment,
    build,
    'kms-encryption-public-key.pem'
  );
  const signingPath = path.join(
    KEYS_BASE_PATH,
    environment,
    build,
    'kms-signing-public-key.pem'
  );

  if (!fs.existsSync(encryptionPath)) {
    throw new Error(
      `Encryption key not found at ${encryptionPath}. Keys must be embedded or provided.`
    );
  }

  if (!fs.existsSync(signingPath)) {
    throw new Error(
      `Signing key not found at ${signingPath}. Keys must be embedded or provided.`
    );
  }

  const encryptionKey = fs.readFileSync(encryptionPath);
  const signingKey = fs.readFileSync(signingPath);

  return { encryptionKey, signingKey };
}

/**
 * Check if keys exist for environment
 */
export function keysExistForEnvironment(
  environment: string,
  build: 'dev' | 'prod' = 'dev'
): boolean {
  const encryptionPath = path.join(
    KEYS_BASE_PATH,
    environment,
    build,
    'kms-encryption-public-key.pem'
  );
  const signingPath = path.join(
    KEYS_BASE_PATH,
    environment,
    build,
    'kms-signing-public-key.pem'
  );

  return fs.existsSync(encryptionPath) && fs.existsSync(signingPath);
}

