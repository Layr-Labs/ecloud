/**
 * Private Key Generation
 *
 * Generate new secp256k1 private keys for Ethereum
 */

import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";

export interface GeneratedKey {
  privateKey: string;
  address: string;
}

/**
 * Generate a new secp256k1 private key
 */
export function generateNewPrivateKey(): GeneratedKey {
  const privateKey = generatePrivateKey();
  const address = privateKeyToAddress(privateKey);

  return {
    privateKey,
    address,
  };
}
