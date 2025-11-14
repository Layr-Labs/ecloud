/**
 * KMS encryption utilities
 * Implements RSA-OAEP + AES-256-GCM encryption
 */

import { Buffer } from "buffer";
import { createRequire } from "module";

// Import node-forge at runtime to work in both ESM and CJS
// This function will be called when encryption is needed
function getForge(): any {
  try {
    // Try ESM context first - use createRequire with import.meta.url
    if (typeof import.meta !== "undefined" && import.meta.url) {
      const requireFn = createRequire(import.meta.url);
      return requireFn("node-forge");
    }
  } catch {
    // Fall through to CJS require
  }

  // CJS context - use regular require
  return require("node-forge");
}

// Cache the forge module
let forgeCache: any = null;
function getForgeCached(): any {
  if (!forgeCache) {
    forgeCache = getForge();
  }
  return forgeCache;
}

/**
 * Get app protected headers for encryption
 */
export function getAppProtectedHeaders(appID: string): Record<string, string> {
  return {
    app_id: appID,
    timestamp: Math.floor(Date.now() / 1000).toString(),
  };
}

/**
 * Encrypt data using RSA-OAEP for key encryption and AES-256-GCM for data encryption
 * This matches the Go implementation in ecloud-kms
 */
export function encryptRSAOAEPAndAES256GCM(
  encryptionKeyPEM: string | Buffer,
  plaintext: Buffer,
  // protectedHeaders: Record<string, string>
): string {
  const pemString =
    typeof encryptionKeyPEM === "string"
      ? encryptionKeyPEM
      : encryptionKeyPEM.toString("utf-8");

  // Parse RSA public key from PEM
  const forge = getForgeCached();
  const publicKey = forge.pki.publicKeyFromPem(pemString);

  // Generate random AES-256 key (32 bytes)
  const aesKey = forge.random.getBytesSync(32);
  const iv = forge.random.getBytesSync(12); // 96-bit IV for GCM

  // Encrypt plaintext with AES-256-GCM
  const cipher = forge.cipher.createCipher("AES-GCM", aesKey);
  cipher.start({ iv });
  cipher.update(forge.util.createBuffer(plaintext.toString("binary")));
  cipher.finish();

  const encrypted = cipher.output.getBytes();
  const tag = cipher.mode.tag.getBytes();

  // Encrypt AES key with RSA-OAEP
  const encryptedAESKey = publicKey.encrypt(aesKey, "RSA-OAEP");

  // Combine: RSA-encrypted key + IV + ciphertext + tag
  // Format: [encrypted_key_length (4 bytes)] [encrypted_key] [iv_length (4 bytes)] [iv] [ciphertext] [tag]
  const encryptedKeyBytes = forge.util.decode64(encryptedAESKey);
  const encryptedKeyLength = Buffer.allocUnsafe(4);
  encryptedKeyLength.writeUInt32BE(encryptedKeyBytes.length, 0);

  const ivLength = Buffer.allocUnsafe(4);
  ivLength.writeUInt32BE(iv.length, 0);

  const combined = Buffer.concat([
    encryptedKeyLength,
    Buffer.from(encryptedKeyBytes, "binary"),
    ivLength,
    Buffer.from(iv, "binary"),
    Buffer.from(encrypted, "binary"),
    Buffer.from(tag, "binary"),
  ]);

  // Base64 encode the result
  return combined.toString("base64");
}

/**
 * Decrypt data (for testing purposes)
 */
export function decryptRSAOAEPAndAES256GCM(
  privateKeyPEM: string,
  encryptedData: string,
): Buffer {
  const combined = Buffer.from(encryptedData, "base64");

  // Extract components
  let offset = 0;
  const encryptedKeyLength = combined.readUInt32BE(offset);
  offset += 4;

  const encryptedKey = combined.subarray(offset, offset + encryptedKeyLength);
  offset += encryptedKeyLength;

  const ivLength = combined.readUInt32BE(offset);
  offset += 4;

  const iv = combined.subarray(offset, offset + ivLength);
  offset += ivLength;

  // Ciphertext is everything except the last 16 bytes (tag)
  const tagLength = 16;
  const ciphertext = combined.subarray(offset, combined.length - tagLength);
  const tag = combined.subarray(combined.length - tagLength);

  // Decrypt AES key with RSA-OAEP
  const forge = getForgeCached();
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPEM);
  const encryptedKeyBase64 = forge.util.encode64(
    encryptedKey.toString("binary"),
  );
  const aesKey = privateKey.decrypt(encryptedKeyBase64, "RSA-OAEP");

  // Decrypt plaintext with AES-256-GCM
  const decipher = forge.cipher.createDecipher("AES-GCM", aesKey);
  decipher.start({ iv: iv.toString("binary"), tag: toByteStringBuffer(tag) });
  decipher.update(forge.util.createBuffer(ciphertext.toString("binary")));
  const success = decipher.finish();

  if (!success) {
    throw new Error("Decryption failed: authentication tag mismatch");
  }

  return Buffer.from(decipher.output.getBytes(), "binary");
}

function toByteStringBuffer(buf: ArrayBuffer | Uint8Array): any {
  const forge = getForgeCached();
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);

  // Efficient binary encode
  const binary = forge.util.binary.raw.encode(u8);

  return forge.util.createBuffer(binary, "raw");
}
