/**
 * Release preparation
 *
 * This module handles building/layering images, encrypting environment variables,
 * and creating the release struct.
 */

import { buildAndPushLayeredImage } from "../docker/layer";
import { layerRemoteImageIfNeeded } from "../docker/layer";
import { getImageDigestAndName } from "../registry/digest";
import { encryptRSAOAEPAndAES256GCM, getAppProtectedHeaders } from "../encryption/kms"; // getAppProtectedHeaders
import { getKMSKeysForEnvironment } from "../utils/keys";
import { REGISTRY_PROPAGATION_WAIT_SECONDS } from "../constants";

import { parseAndValidateEnvFile } from "../env/parser";

import { Release, EnvironmentConfig, Logger } from "../types";

export interface PrepareReleaseOptions {
  dockerfilePath?: string;
  imageRef: string;
  envFilePath?: string;
  logRedirect: string;
  resourceUsageAllow: string;
  instanceType: string;
  environmentConfig: EnvironmentConfig;
  appId: string;
}

export interface PrepareReleaseResult {
  release: Release;
  finalImageRef: string;
}

/**
 * Prepare release from context
 */
export async function prepareRelease(
  options: PrepareReleaseOptions,
  logger: Logger,
): Promise<PrepareReleaseResult> {
  const {
    dockerfilePath,
    imageRef,
    envFilePath,
    logRedirect,
    resourceUsageAllow,
    instanceType,
    environmentConfig,
  } = options;

  let finalImageRef = imageRef;

  // 1. Build/layer image if needed
  if (dockerfilePath) {
    // Build from Dockerfile
    logger.info("Building and pushing layered image...");
    finalImageRef = await buildAndPushLayeredImage(
      {
        dockerfilePath,
        targetImageRef: imageRef,
        logRedirect,
        resourceUsageAllow,
        envFilePath,
        environmentConfig,
      },
      logger,
    );

    // Wait for registry propagation
    logger.info(`Waiting ${REGISTRY_PROPAGATION_WAIT_SECONDS} seconds for registry propagation...`);
    await new Promise((resolve) => setTimeout(resolve, REGISTRY_PROPAGATION_WAIT_SECONDS * 1000));
  } else {
    // Layer remote image if needed
    logger.info("Checking if image needs layering...");
    finalImageRef = await layerRemoteImageIfNeeded(
      {
        imageRef,
        logRedirect,
        resourceUsageAllow,
        envFilePath,
        environmentConfig,
      },
      logger,
    );

    // Wait for registry propagation if image was layered
    if (finalImageRef !== imageRef) {
      logger.info(
        `Waiting ${REGISTRY_PROPAGATION_WAIT_SECONDS} seconds for registry propagation...`,
      );
      await new Promise((resolve) => setTimeout(resolve, REGISTRY_PROPAGATION_WAIT_SECONDS * 1000));
    }
  }

  // 2. Wait a moment for registry to process the push (especially for GHCR)
  logger.info("Waiting for registry to process image...");
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // 3. Get image digest and registry name
  logger.info("Extracting image digest...");
  let digest: Uint8Array | undefined;
  let registry: string | undefined;

  // Retry getting digest in case registry needs more time
  let retries = 3;
  let lastError: Error | null = null;

  while (retries > 0) {
    try {
      const result = await getImageDigestAndName(finalImageRef);
      digest = result.digest;
      registry = result.registry;
      break;
    } catch (error: any) {
      lastError = error;
      retries--;
      if (retries > 0) {
        logger.info(`Digest extraction failed, retrying in 2 seconds... (${retries} retries left)`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  if (!digest || !registry) {
    throw new Error(
      `Failed to get image digest after retries. This usually means the image wasn't pushed successfully.\n` +
        `Original error: ${lastError?.message}\n` +
        `Please verify the image exists: docker manifest inspect ${finalImageRef}`,
    );
  }

  logger.info(`Image digest: ${Buffer.from(digest).toString("hex")}`);
  logger.info(`Registry: ${registry}`);

  // 4. Parse and validate environment file
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

  // 4. Add instance type to public env
  publicEnv["EIGEN_MACHINE_TYPE"] = instanceType;
  logger.info(`Instance type: ${instanceType}`);

  // 5. Encrypt private environment variables
  logger.info("Encrypting environment variables...");
  const { encryptionKey } = getKMSKeysForEnvironment(
    environmentConfig.name,
    environmentConfig.build,
  );
  const protectedHeaders = getAppProtectedHeaders(options.appId);
  const privateEnvBytes = Buffer.from(JSON.stringify(privateEnv));
  const encryptedEnvStr = await encryptRSAOAEPAndAES256GCM(
    encryptionKey,
    privateEnvBytes,
    protectedHeaders,
  );

  // 6. Create release struct
  const release: Release = {
    rmsRelease: {
      artifacts: [
        {
          digest: new Uint8Array(digest),
          registry: registry,
        },
      ],
      upgradeByTime: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    },
    publicEnv: new Uint8Array(Buffer.from(JSON.stringify(publicEnv))),
    encryptedEnv: new Uint8Array(Buffer.from(encryptedEnvStr)),
  };

  return {
    release,
    finalImageRef,
  };
}
