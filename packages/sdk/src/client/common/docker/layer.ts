/**
 * Docker image layering
 *
 * This module handles adding ecloud components to Docker images
 */

import Docker from "dockerode";

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  extractImageConfig,
  checkIfImageAlreadyLayeredForECloud,
  pullDockerImage,
} from "./inspect";
import { buildDockerImage } from "./build";
import { pushDockerImage } from "./push";
import { processDockerfileTemplate } from "../templates/dockerfileTemplate";
import { processScriptTemplate } from "../templates/scriptTemplate";
import { getKMSKeysForEnvironment } from "../utils/keys";

import {
  LAYERED_DOCKERFILE_NAME,
  ENV_SOURCE_SCRIPT_NAME,
  KMS_CLIENT_BINARY_NAME,
  KMS_SIGNING_KEY_NAME,
  TLS_KEYGEN_BINARY_NAME,
  CADDYFILE_NAME,
  LAYERED_BUILD_DIR_PREFIX,
  DOCKER_PLATFORM,
} from "../constants";

import { getDirname } from "../utils/dirname";

import { EnvironmentConfig, Logger } from "../types";

/**
 * Find binary file in tools directory
 * Supports both CLI (bundled) and standalone SDK usage
 */
function findBinary(binaryName: string): string {
  const __dirname = getDirname();

  // Try to find SDK root by looking for tools directory
  // Start from current directory and walk up
  let currentDir = __dirname;
  const maxDepth = 10;
  let depth = 0;

  while (depth < maxDepth) {
    const toolsPath = path.join(currentDir, "tools", binaryName);
    if (fs.existsSync(toolsPath)) {
      return toolsPath;
    }

    // Also check if we're in a monorepo structure
    const sdkToolsPath = path.join(currentDir, "packages", "sdk", "tools", binaryName);
    if (fs.existsSync(sdkToolsPath)) {
      return sdkToolsPath;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break; // Reached filesystem root
    }
    currentDir = parentDir;
    depth++;
  }

  // Try relative paths as fallback
  const possiblePaths = [
    path.join(__dirname, "../../../tools", binaryName), // Standalone SDK from dist
    path.join(__dirname, "../../../../tools", binaryName), // CLI bundled
    path.join(__dirname, "../../../../../tools", binaryName), // Alternative CLI path
    path.resolve(__dirname, "../../../../tools", binaryName), // From source
    path.resolve(__dirname, "../../../../../tools", binaryName), // From source alternative
  ];

  for (const possiblePath of possiblePaths) {
    if (fs.existsSync(possiblePath)) {
      return possiblePath;
    }
  }

  // Return the most likely path for error messages
  return path.resolve(__dirname, "../../../../tools", binaryName);
}

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
  logger: Logger,
): Promise<string> {
  const { dockerfilePath, targetImageRef, logRedirect, envFilePath, environmentConfig } = options;

  // 1. Build base image from user's Dockerfile
  const baseImageTag = `ecloud-temp-${path.basename(dockerfilePath).toLowerCase()}`;
  logger.info(`Building base image from ${dockerfilePath}...`);

  // Use the directory containing the Dockerfile as build context
  const buildContext = path.dirname(dockerfilePath);
  await buildDockerImage(buildContext, dockerfilePath, baseImageTag, logger);

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
    logger,
  );
}

/**
 * Layer remote image if needed
 */
export async function layerRemoteImageIfNeeded(
  options: LayerRemoteImageIfNeededOptions,
  logger: Logger,
): Promise<string> {
  const { imageRef, logRedirect, envFilePath, environmentConfig } = options;

  const docker = new Docker();

  // Check if image already has ecloud layering
  const alreadyLayered = await checkIfImageAlreadyLayeredForECloud(docker, imageRef);
  if (alreadyLayered) {
    logger.info("Image already has ecloud layering");
    return imageRef;
  }

  // Pull image to ensure we have it locally
  logger.info(`Pulling image ${imageRef}...`);
  await pullDockerImage(docker, imageRef, DOCKER_PLATFORM, logger);

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
    logger,
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
  logger: Logger,
): Promise<string> {
  const { docker, sourceImageRef, targetImageRef, logRedirect, envFilePath, environmentConfig } =
    options;

  // 1. Extract original command and user from source image
  const imageConfig = await extractImageConfig(docker, sourceImageRef);
  const originalCmd = imageConfig.cmd.length > 0 ? imageConfig.cmd : imageConfig.entrypoint;
  const originalUser = imageConfig.user;

  // 2. Check if TLS is needed (check for DOMAIN in env file)
  let includeTLS = false;
  if (envFilePath && fs.existsSync(envFilePath)) {
    const envContent = fs.readFileSync(envFilePath, "utf-8");
    const domainMatch = envContent.match(/^DOMAIN=(.+)$/m);
    if (domainMatch && domainMatch[1] && domainMatch[1] !== "localhost") {
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
    ecloudCLIVersion: "0.1.0", // TODO: Get from package.json
  });

  const scriptContent = processScriptTemplate({
    kmsServerURL: environmentConfig.kmsServerURL,
    userAPIURL: environmentConfig.userApiServerURL,
  });

  // 4. Setup build directory
  const tempDir = await setupLayeredBuildDirectory(
    environmentConfig,
    layeredDockerfileContent,
    scriptContent,
    includeTLS,
    // logger
  );

  try {
    // 5. Build layered image
    logger.info(`Building updated image with ecloud components for ${sourceImageRef}...`);
    const layeredDockerfilePath = path.join(tempDir, LAYERED_DOCKERFILE_NAME);
    await buildDockerImage(tempDir, layeredDockerfilePath, targetImageRef, logger);

    // 6. Push to registry
    logger.info(`Publishing updated image to ${targetImageRef}...`);
    await pushDockerImage(docker, targetImageRef, logger);

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
  // logger?: Logger
): Promise<string> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), LAYERED_BUILD_DIR_PREFIX));

  try {
    // Write layered Dockerfile
    const layeredDockerfilePath = path.join(tempDir, LAYERED_DOCKERFILE_NAME);
    fs.writeFileSync(layeredDockerfilePath, layeredDockerfileContent, {
      mode: 0o644,
    });

    // Write wrapper script
    const scriptPath = path.join(tempDir, ENV_SOURCE_SCRIPT_NAME);
    fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

    // Copy KMS keys
    const { signingKey } = getKMSKeysForEnvironment(
      environmentConfig.name,
      environmentConfig.build,
    );

    const signingKeyPath = path.join(tempDir, KMS_SIGNING_KEY_NAME);
    fs.writeFileSync(signingKeyPath, signingKey, { mode: 0o644 });

    // Copy kms-client binary
    const kmsClientPath = path.join(tempDir, KMS_CLIENT_BINARY_NAME);
    const kmsClientSource = findBinary("kms-client-linux-amd64");
    if (!fs.existsSync(kmsClientSource)) {
      throw new Error(
        `kms-client binary not found. Expected at: ${kmsClientSource}. ` +
          "Make sure binaries are in packages/sdk/tools/ directory.",
      );
    }
    fs.copyFileSync(kmsClientSource, kmsClientPath);
    fs.chmodSync(kmsClientPath, 0o755);

    // Include TLS components if requested
    if (includeTLS) {
      // Copy tls-keygen binary
      const tlsKeygenPath = path.join(tempDir, TLS_KEYGEN_BINARY_NAME);
      const tlsKeygenSource = findBinary("tls-keygen-linux-amd64");
      if (!fs.existsSync(tlsKeygenSource)) {
        throw new Error(
          `tls-keygen binary not found. Expected at: ${tlsKeygenSource}. ` +
            "Make sure binaries are in packages/sdk/tools/ directory.",
        );
      }
      fs.copyFileSync(tlsKeygenSource, tlsKeygenPath);
      fs.chmodSync(tlsKeygenPath, 0o755);

      // Handle Caddyfile
      const caddyfilePath = path.join(process.cwd(), CADDYFILE_NAME);
      if (fs.existsSync(caddyfilePath)) {
        const caddyfileContent = fs.readFileSync(caddyfilePath);
        const destCaddyfilePath = path.join(tempDir, CADDYFILE_NAME);
        fs.writeFileSync(destCaddyfilePath, caddyfileContent, { mode: 0o644 });
      } else {
        throw new Error(
          "TLS is enabled (DOMAIN is set) but Caddyfile not found. " +
            "Run configure TLS to set up TLS configuration",
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
