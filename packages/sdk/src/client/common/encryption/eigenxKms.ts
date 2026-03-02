/**
 * Encryption using eigenx-kms-client binary (v2 KMS)
 *
 * Uses Identity-Based Encryption (IBE) with keys fetched dynamically
 * from an on-chain operator set.
 */

import { execFileSync } from "child_process";

/**
 * Encrypt data using the eigenx-kms-client binary.
 *
 * The binary must be available on the developer's PATH.
 *
 * @param ethRpcUrl - Ethereum RPC URL for on-chain key lookups
 * @param avsAddress - AVS contract address
 * @param operatorSetId - Operator set ID
 * @param appId - Application ID
 * @param data - JSON string of data to encrypt
 * @returns hex-encoded ciphertext string
 */
export function encryptWithEigenxKmsClient(
  ethRpcUrl: string,
  avsAddress: string,
  operatorSetId: number,
  appId: string,
  data: string,
): string {
  if (!avsAddress) {
    throw new Error(
      "avsAddress is not configured for this environment. " +
        "Cannot use --use-kms-v2 without a valid avsAddress in the environment config.",
    );
  }

  try {
    const result = execFileSync(
      "eigenx-kms-client",
      [
        "encrypt",
        "--eth-rpc-url",
        ethRpcUrl,
        "--avs-address",
        avsAddress,
        "--operator-set-id",
        String(operatorSetId),
        "--app-id",
        appId,
        "--data",
        data,
      ],
      {
        encoding: "utf-8",
        timeout: 60_000,
      },
    );

    return result.trim();
  } catch (error: any) {
    if (error.code === "ENOENT") {
      throw new Error(
        "eigenx-kms-client binary not found on PATH. " +
          "Please install eigenx-kms-client to use --use-kms-v2.",
      );
    }
    throw new Error(`eigenx-kms-client encrypt failed: ${error.message}`);
  }
}
