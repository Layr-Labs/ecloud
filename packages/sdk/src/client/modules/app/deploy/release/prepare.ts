/**
 * Release preparation
 * 
 * This module handles building/layering images, encrypting environment variables,
 * and creating the release struct.
 */

import { Release, EnvironmentConfig, Logger } from '../types';
import { buildAndPushLayeredImage } from '../docker/layer';
import { layerRemoteImageIfNeeded } from '../docker/layer';
import { getImageDigestAndName } from '../registry/digest';
import { parseAndValidateEnvFile } from '../env/parser';
import { encryptRSAOAEPAndAES256GCM, getAppProtectedHeaders } from '../encryption/kms';
import { getKMSKeysForEnvironment } from '../utils/keys';
import { REGISTRY_PROPAGATION_WAIT_SECONDS } from '../constants';

export interface PrepareReleaseOptions {
  dockerfilePath?: string;
  imageRef: string;
  envFilePath?: string;
  logRedirect: string;
  instanceType: string;
  environmentConfig: EnvironmentConfig;
  appID: string;
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
  logger: Logger
): Promise<PrepareReleaseResult> {
  const {
    dockerfilePath,
    imageRef,
    envFilePath,
    logRedirect,
    instanceType,
    environmentConfig,
    appID,
  } = options;

  let finalImageRef = imageRef;

  // 1. Build/layer image if needed
  if (dockerfilePath) {
    // Build from Dockerfile
    logger.info('Building and pushing layered image...');
    finalImageRef = await buildAndPushLayeredImage(
      {
        dockerfilePath,
        targetImageRef: imageRef,
        logRedirect,
        envFilePath,
        environmentConfig,
      },
      logger
    );

    // Wait for registry propagation
    logger.info(
      `Waiting ${REGISTRY_PROPAGATION_WAIT_SECONDS} seconds for registry propagation...`
    );
    await new Promise((resolve) =>
      setTimeout(resolve, REGISTRY_PROPAGATION_WAIT_SECONDS * 1000)
    );
  } else {
    // Layer remote image if needed
    logger.info('Checking if image needs layering...');
    finalImageRef = await layerRemoteImageIfNeeded(
      {
        imageRef,
        logRedirect,
        envFilePath,
        environmentConfig,
      },
      logger
    );

    // Wait for registry propagation if image was layered
    if (finalImageRef !== imageRef) {
      logger.info(
        `Waiting ${REGISTRY_PROPAGATION_WAIT_SECONDS} seconds for registry propagation...`
      );
      await new Promise((resolve) =>
        setTimeout(resolve, REGISTRY_PROPAGATION_WAIT_SECONDS * 1000)
      );
    }
  }

  // 2. Get image digest and registry name
  logger.info('Extracting image digest...');
  const { digest, registry } = await getImageDigestAndName(finalImageRef);
  logger.info(`Image digest: ${Buffer.from(digest).toString('hex')}`);
  logger.info(`Registry: ${registry}`);

  // 3. Parse and validate environment file
  let publicEnv: Record<string, string> = {};
  let privateEnv: Record<string, string> = {};

  if (envFilePath) {
    logger.info('Parsing environment file...');
    const parsed = parseAndValidateEnvFile(envFilePath);
    publicEnv = parsed.public;
    privateEnv = parsed.private;
  } else {
    logger.info('Continuing without environment file');
  }

  // 4. Add instance type to public env
  publicEnv['EIGEN_MACHINE_TYPE'] = instanceType;
  logger.info(`Instance type: ${instanceType}`);

  // 5. Encrypt private environment variables
  logger.info('Encrypting environment variables...');
  const { encryptionKey } = getKMSKeysForEnvironment(environmentConfig.name);
  const protectedHeaders = getAppProtectedHeaders(appID);
  const privateEnvBytes = Buffer.from(JSON.stringify(privateEnv));
  const encryptedEnvStr = encryptRSAOAEPAndAES256GCM(
    encryptionKey,
    privateEnvBytes,
    protectedHeaders
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

