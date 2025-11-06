/**
 * Docker image layering
 * 
 * This module handles adding ecloud components to Docker images
 */

import Docker from 'dockerode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EnvironmentConfig, Logger } from '../types';
import { extractImageConfig, checkIfImageAlreadyLayeredForecloud, pullDockerImage } from './inspect';
import { buildDockerImage } from './build';
import { pushDockerImage } from './push';
import { processDockerfileTemplate } from '../templates/dockerfileTemplate';
import { processScriptTemplate } from '../templates/scriptTemplate';
import { getKMSKeysForEnvironment } from '../utils/keys';
import {
  LAYERED_DOCKERFILE_NAME,
  ENV_SOURCE_SCRIPT_NAME,
  KMS_CLIENT_BINARY_NAME,
  KMS_ENCRYPTION_KEY_NAME,
  KMS_SIGNING_KEY_NAME,
  TLS_KEYGEN_BINARY_NAME,
  CADDYFILE_NAME,
  LAYERED_BUILD_DIR_PREFIX,
  DOCKER_PLATFORM,
} from '../constants';

export interface BuildAndPushLayeredImageOptions {
  dockerfilePath: string;
  targetImageRef: string;
  logRedirect: string;
  envFilePath?: string;
  environmentConfig: EnvironmentConfig;
}

export interface LayerRemoteImageIfNeededOptions {
  imageRef: string;
  logRedirect: string;
  envFilePath?: string;
  environmentConfig: EnvironmentConfig;
}

/**
 * Build and push layered image from Dockerfile
 */
export async function buildAndPushLayeredImage(
  options: BuildAndPushLayeredImageOptions,
  logger: Logger
): Promise<string> {
  const { dockerfilePath, targetImageRef, logRedirect, envFilePath, environmentConfig } = options;

  // 1. Build base image from user's Dockerfile
  const baseImageTag = `ecloud-temp-${path.basename(dockerfilePath).toLowerCase()}`;
  logger.info(`Building base image from ${dockerfilePath}...`);

  await buildDockerImage('.', dockerfilePath, baseImageTag, logger);

  // 2. Layer the base image
  const docker = new Docker();
  return layerLocalImage(
    {
      docker,
      sourceImageRef: baseImageTag,
      targetImageRef,
      logRedirect,
      envFilePath,
      environmentConfig,
    },
    logger
  );
}

/**
 * Layer remote image if needed
 */
export async function layerRemoteImageIfNeeded(
  options: LayerRemoteImageIfNeededOptions,
  logger: Logger
): Promise<string> {
  const { imageRef, logRedirect, envFilePath, environmentConfig } = options;

  const docker = new Docker();

  // Check if image already has ecloud layering
  const alreadyLayered = await checkIfImageAlreadyLayeredForecloud(docker, imageRef);
  if (alreadyLayered) {
    logger.info('Image already has ecloud layering');
    return imageRef;
  }

  // Pull image to ensure we have it locally
  logger.info(`Pulling image ${imageRef}...`);
  await pullDockerImage(docker, imageRef, DOCKER_PLATFORM);

  // Prompt for target image (to avoid overwriting source)
  // TODO: Make this configurable via options
  const targetImageRef = `${imageRef}-layered`;

  logger.info(`Adding ecloud components to create ${targetImageRef} from ${imageRef}...`);
  const layeredImageRef = await layerLocalImage(
    {
      docker,
      sourceImageRef: imageRef,
      targetImageRef,
      logRedirect,
      envFilePath,
      environmentConfig,
    },
    logger
  );

  return layeredImageRef;
}

/**
 * Layer local image with ecloud components
 */
async function layerLocalImage(
  options: {
    docker: Docker;
    sourceImageRef: string;
    targetImageRef: string;
    logRedirect: string;
    envFilePath?: string;
    environmentConfig: EnvironmentConfig;
  },
  logger: Logger
): Promise<string> {
  const { docker, sourceImageRef, targetImageRef, logRedirect, envFilePath, environmentConfig } = options;

  // 1. Extract original command and user from source image
  const imageConfig = await extractImageConfig(docker, sourceImageRef);
  const originalCmd = imageConfig.cmd.length > 0 ? imageConfig.cmd : imageConfig.entrypoint;
  const originalUser = imageConfig.user;

  // 2. Check if TLS is needed (check for DOMAIN in env file)
  let includeTLS = false;
  if (envFilePath && fs.existsSync(envFilePath)) {
    const envContent = fs.readFileSync(envFilePath, 'utf-8');
    const domainMatch = envContent.match(/^DOMAIN=(.+)$/m);
    if (domainMatch && domainMatch[1] && domainMatch[1] !== 'localhost') {
      includeTLS = true;
      logger.debug(`Found DOMAIN=${domainMatch[1]} in ${envFilePath}, including TLS components`);
    }
  }

  // 3. Generate template content
  const layeredDockerfileContent = processDockerfileTemplate({
    baseImage: sourceImageRef,
    originalCmd: JSON.stringify(originalCmd),
    originalUser: originalUser,
    logRedirect: logRedirect,
    includeTLS: includeTLS,
    ecloudCLIVersion: '0.1.0', // TODO: Get from package.json
  });

  const scriptContent = processScriptTemplate({
    KMSServerURL: environmentConfig.kmsServerURL,
    JWTFile: '/run/container_launcher/attestation_verifier_claims_token',
    UserAPIURL: environmentConfig.userApiServerURL,
  });

  // 4. Setup build directory
  const tempDir = await setupLayeredBuildDirectory(
    environmentConfig,
    layeredDockerfileContent,
    scriptContent,
    includeTLS,
    logger
  );

  try {
    // 5. Build layered image
    logger.info(`Building updated image with ecloud components for ${sourceImageRef}...`);
    const layeredDockerfilePath = path.join(tempDir, LAYERED_DOCKERFILE_NAME);
    await buildDockerImage(tempDir, layeredDockerfilePath, targetImageRef, logger);

    // 6. Push to registry
    logger.info(`Publishing updated image to ${targetImageRef}...`);
    await pushDockerImage(docker, targetImageRef);

    logger.info(`Successfully published updated image: ${targetImageRef}`);
    return targetImageRef;
  } finally {
    // Cleanup temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Setup layered build directory with all required files
 */
async function setupLayeredBuildDirectory(
  environmentConfig: EnvironmentConfig,
  layeredDockerfileContent: string,
  scriptContent: string,
  includeTLS: boolean,
  logger?: Logger
): Promise<string> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), LAYERED_BUILD_DIR_PREFIX));

  try {
    // Write layered Dockerfile
    const layeredDockerfilePath = path.join(tempDir, LAYERED_DOCKERFILE_NAME);
    fs.writeFileSync(layeredDockerfilePath, layeredDockerfileContent, { mode: 0o644 });

    // Write wrapper script
    const scriptPath = path.join(tempDir, ENV_SOURCE_SCRIPT_NAME);
    fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

    // Copy KMS keys
    const { encryptionKey, signingKey } = getKMSKeysForEnvironment(environmentConfig.name);

    const encryptionKeyPath = path.join(tempDir, KMS_ENCRYPTION_KEY_NAME);
    fs.writeFileSync(encryptionKeyPath, encryptionKey, { mode: 0o644 });

    const signingKeyPath = path.join(tempDir, KMS_SIGNING_KEY_NAME);
    fs.writeFileSync(signingKeyPath, signingKey, { mode: 0o644 });

    // Copy kms-client binary
    // TODO: Embed kms-client binary or load from path
    const kmsClientPath = path.join(tempDir, KMS_CLIENT_BINARY_NAME);
    // fs.writeFileSync(kmsClientPath, kmsClientBinary, { mode: 0o755 });
    // Note: kms-client binary needs to be embedded or provided

    // Include TLS components if requested
    if (includeTLS) {
      // Copy tls-keygen binary
      // TODO: Embed tls-keygen binary or load from path
      const tlsKeygenPath = path.join(tempDir, TLS_KEYGEN_BINARY_NAME);
      // fs.writeFileSync(tlsKeygenPath, tlsKeygenBinary, { mode: 0o755 });
      // Note: tls-keygen binary needs to be embedded or provided

      // Handle Caddyfile
      const caddyfilePath = path.join(process.cwd(), CADDYFILE_NAME);
      if (fs.existsSync(caddyfilePath)) {
        const caddyfileContent = fs.readFileSync(caddyfilePath);
        const destCaddyfilePath = path.join(tempDir, CADDYFILE_NAME);
        fs.writeFileSync(destCaddyfilePath, caddyfileContent, { mode: 0o644 });
      } else {
        throw new Error(
          'TLS is enabled (DOMAIN is set) but Caddyfile not found. ' +
          'Run configure TLS to set up TLS configuration'
        );
      }
    }

    return tempDir;
  } catch (error) {
    // Cleanup on error
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

