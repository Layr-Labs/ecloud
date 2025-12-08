/**
 * KMS encryption utilities
 * Implements RSA-OAEP-256 + AES-256-GCM encryption using JWE format
 */

import { Buffer } from "buffer";
import { importSPKI, CompactEncrypt, type CompactJWEHeaderParameters } from "jose";

/**
 * Get app protected headers for encryption
 */
export function getAppProtectedHeaders(appID: string): Record<string, string> {
  return {
    "x-eigenx-app-id": appID,
  };
}

/**
 * Encrypt data using RSA-OAEP-256 for key encryption and AES-256-GCM for data encryption
 * Uses jose library which properly implements JWE with RSA-OAEP-256
 */
export async function encryptRSAOAEPAndAES256GCM(
  encryptionKeyPEM: string | Buffer,
  plaintext: Buffer,
  protectedHeaders?: Record<string, string> | null,
): Promise<string> {
  const pemString =
    typeof encryptionKeyPEM === "string" ? encryptionKeyPEM : encryptionKeyPEM.toString("utf-8");

  // Import RSA public key from PEM format
  // jose handles both PKIX and PKCS#1 formats automatically
  const publicKey = await importSPKI(pemString, "RSA-OAEP-256", {
    extractable: true,
  });

  // Build protected header
  const header: CompactJWEHeaderParameters = {
    alg: "RSA-OAEP-256", // Key encryption algorithm (SHA-256)
    enc: "A256GCM", // Content encryption algorithm
    ...(protectedHeaders || {}), // Add custom protected headers
  };

  // Encrypt using JWE compact serialization
  // CompactEncrypt is a class that builds and encrypts Compact JWE strings
  // Convert Buffer to Uint8Array for jose library
  const plaintextBytes = new Uint8Array(plaintext);
  const jwe = await new CompactEncrypt(plaintextBytes)
    .setProtectedHeader(header)
    .encrypt(publicKey);

  return jwe;
}
