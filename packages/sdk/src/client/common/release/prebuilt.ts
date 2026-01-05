import { parseAndValidateEnvFile } from "../env/parser";
import { encryptRSAOAEPAndAES256GCM, getAppProtectedHeaders } from "../encryption/kms";
import { getKMSKeysForEnvironment } from "../utils/keys";
import type { EnvironmentConfig, Logger, Release } from "../types";

export interface CreateReleaseFromImageDigestOptions {
  imageRef: string;
  imageDigest: string; // sha256:...
  envFilePath?: string;
  instanceType: string;
  environmentConfig: EnvironmentConfig;
  appId: string;
}

/**
 * Construct a Release struct from a prebuilt image (already layered) and a sha256 digest.
 *
 * This mirrors the non-verifiable path in `common/release/prepare.ts`, but skips Docker.
 */
export async function createReleaseFromImageDigest(
  options: CreateReleaseFromImageDigestOptions,
  logger: Logger,
): Promise<Release> {
  const { imageRef, imageDigest, envFilePath, instanceType, environmentConfig, appId } = options;

  if (!/^sha256:[0-9a-f]{64}$/i.test(imageDigest)) {
    throw new Error(`imageDigest must be in format sha256:<64 hex>, got: ${imageDigest}`);
  }

  // Parse and validate environment file
  let publicEnv: Record<string, string> = {};
  let privateEnv: Record<string, string> = {};

  if (envFilePath) {
    logger.info("Parsing environment file...");
    const parsed = parseAndValidateEnvFile(envFilePath);
    publicEnv = parsed.public;
    privateEnv = parsed.private;
  } else {
    logger.info("Continuing without environment file");
  }

  // Add instance type to public env
  publicEnv["EIGEN_MACHINE_TYPE_PUBLIC"] = instanceType;
  logger.info(`Instance type: ${instanceType}`);

  // Encrypt private environment variables
  logger.info("Encrypting environment variables...");
  const { encryptionKey } = getKMSKeysForEnvironment(
    environmentConfig.name,
    environmentConfig.build,
  );
  const protectedHeaders = getAppProtectedHeaders(appId);
  const privateEnvBytes = Buffer.from(JSON.stringify(privateEnv));
  const encryptedEnvStr = await encryptRSAOAEPAndAES256GCM(
    encryptionKey,
    privateEnvBytes,
    protectedHeaders,
  );

  // Convert digest to bytes32
  const digestHex = imageDigest.split(":")[1]!;
  const digestBytes = new Uint8Array(Buffer.from(digestHex, "hex"));
  if (digestBytes.length !== 32) {
    throw new Error(`Digest must be exactly 32 bytes, got ${digestBytes.length}`);
  }

  const registry = extractRegistryNameNoDocker(imageRef);

  return {
    rmsRelease: {
      artifacts: [{ digest: digestBytes, registry }],
      upgradeByTime: Math.floor(Date.now() / 1000) + 3600,
    },
    publicEnv: new Uint8Array(Buffer.from(JSON.stringify(publicEnv))),
    encryptedEnv: new Uint8Array(Buffer.from(encryptedEnvStr)),
  };
}

function extractRegistryNameNoDocker(imageRef: string): string {
  // Same behavior as common/registry/digest.ts extractRegistryName()
  let name = imageRef;

  // Remove tag if present
  const tagIndex = name.lastIndexOf(":");
  if (tagIndex !== -1 && !name.substring(tagIndex + 1).includes("/")) {
    name = name.substring(0, tagIndex);
  }

  // Remove digest if present
  const digestIndex = name.indexOf("@");
  if (digestIndex !== -1) {
    name = name.substring(0, digestIndex);
  }

  // Prefix with docker.io/ if no registry is provided
  if ([...name].filter((c) => c === "/").length === 1) {
    name = `docker.io/${name}`;
  }

  return name;
}
