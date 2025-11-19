/**
 * Image registry operations - digest extraction
 *
 * Uses Docker API to extract image digest and validate platform
 */

import * as child_process from "child_process";
import { promisify } from "util";
import { ImageDigestResult } from "../types";
import { DOCKER_PLATFORM } from "../constants";

const exec = promisify(child_process.exec);

interface Platform {
  os: string;
  architecture: string;
}

interface ManifestManifest {
  digest: string;
  platform?: Platform;
}

interface Manifest {
  manifests?: ManifestManifest[];
  config?: {
    digest: string;
  };
  mediaType?: string;
}

/**
 * Get image digest and registry name from image reference
 * Uses docker manifest inspect to get the manifest
 */
export async function getImageDigestAndName(
  imageRef: string,
): Promise<ImageDigestResult> {
  try {
    // Use docker manifest inspect to get the manifest
    const { stdout } = await exec(`docker manifest inspect ${imageRef}`, {
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    const manifest: Manifest = JSON.parse(stdout);

    // Check if it's a multi-platform manifest (index)
    if (manifest.manifests && manifest.manifests.length > 0) {
      return extractDigestFromMultiPlatform(manifest, imageRef);
    } else {
      // Single-platform image
      return extractDigestFromSinglePlatform(manifest, imageRef);
    }
  } catch (error: any) {
    throw new Error(
      `Failed to get image digest for ${imageRef}: ${error.message}`,
    );
  }
}

/**
 * Extract digest from multi-platform image index
 */
function extractDigestFromMultiPlatform(
  manifest: Manifest,
  imageRef: string,
): ImageDigestResult {
  if (!manifest.manifests) {
    throw new Error(`Invalid manifest for ${imageRef}: no manifests found`);
  }

  const platforms: string[] = [];

  for (const m of manifest.manifests) {
    if (m.platform) {
      const platform = `${m.platform.os}/${m.platform.architecture}`;
      platforms.push(platform);

      if (platform === DOCKER_PLATFORM) {
        const digest = hexStringToBytes32(m.digest);
        const registry = extractRegistryName(imageRef);
        return {
          digest,
          registry,
          platform: DOCKER_PLATFORM,
        };
      }
    }
  }

  // No compatible platform found
  throw createPlatformErrorMessage(imageRef, platforms);
}

/**
 * Extract digest from single-platform image
 * For single-platform images, we need to inspect the image config
 */
async function extractDigestFromSinglePlatform(
  manifest: Manifest,
  imageRef: string,
): Promise<ImageDigestResult> {
  // For single-platform images, we need to get the config digest
  // and then inspect the image to get platform info
  try {
    // Use docker inspect to get platform info
    const { stdout } = await exec(`docker inspect ${imageRef}`, {
      maxBuffer: 10 * 1024 * 1024,
    });

    const inspectData = JSON.parse(stdout);
    if (!inspectData || !inspectData[0]) {
      throw new Error(`Failed to inspect image ${imageRef}`);
    }

    const config = inspectData[0].Architecture
      ? {
          os: inspectData[0].Os || "linux",
          architecture: inspectData[0].Architecture,
        }
      : null;

    if (!config) {
      // Try to get from manifest config digest
      if (manifest.config?.digest) {
        const digest = hexStringToBytes32(manifest.config.digest);
        const registry = extractRegistryName(imageRef);
        // Assume linux/amd64 if we can't determine platform
        return {
          digest,
          registry,
          platform: DOCKER_PLATFORM,
        };
      }
      throw new Error(`Could not determine platform for ${imageRef}`);
    }

    const platform = `${config.os}/${config.architecture}`;

    if (platform === DOCKER_PLATFORM) {
      // Get digest from RepoDigests or use config digest
      let digest: Uint8Array;
      if (inspectData[0].RepoDigests && inspectData[0].RepoDigests.length > 0) {
        const repoDigest = inspectData[0].RepoDigests[0];
        digest = extractDigestFromRepoDigest(repoDigest);
      } else if (manifest.config?.digest) {
        digest = hexStringToBytes32(manifest.config.digest);
      } else {
        throw new Error(`Could not extract digest for ${imageRef}`);
      }

      const registry = extractRegistryName(imageRef);
      return {
        digest,
        registry,
        platform: DOCKER_PLATFORM,
      };
    }

    // Platform mismatch
    throw createPlatformErrorMessage(imageRef, [platform]);
  } catch (error: any) {
    if (error.message.includes("platform")) {
      throw error;
    }
    throw new Error(
      `Failed to extract digest from single-platform image ${imageRef}: ${error.message}`,
    );
  }
}

/**
 * Convert hex string to 32-byte array
 */
function hexStringToBytes32(hexStr: string): Uint8Array {
  // Remove "sha256:" prefix if present
  let cleanHex = hexStr;
  if (hexStr.includes(":")) {
    cleanHex = hexStr.split(":")[1];
  }

  // Decode hex string
  const bytes = Buffer.from(cleanHex, "hex");

  if (bytes.length !== 32) {
    throw new Error(`Digest must be exactly 32 bytes, got ${bytes.length}`);
  }

  return new Uint8Array(bytes);
}

/**
 * Extract digest from repo digest string
 * Format: "repo@sha256:xxxxx" -> returns 32-byte digest
 */
function extractDigestFromRepoDigest(repoDigest: string): Uint8Array {
  const prefix = "@sha256:";
  const idx = repoDigest.lastIndexOf(prefix);
  if (idx === -1) {
    throw new Error(`Invalid repo digest format: ${repoDigest}`);
  }

  const hexDigest = repoDigest.substring(idx + prefix.length);
  return hexStringToBytes32(hexDigest);
}

/**
 * Extract registry name from image reference
 * e.g., "ghcr.io/user/repo:tag" -> "ghcr.io/user/repo"
 */
function extractRegistryName(imageRef: string): string {
  // Remove tag if present
  let name = imageRef;
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
  if ([...name].filter(c => c === "/").length === 1) {
    name = `docker.io/${name}`;
  }

  // Default registry
  return name;
}

/**
 * Create platform error message
 */
function createPlatformErrorMessage(
  imageRef: string,
  platforms: string[],
): Error {
  const errorMsg = `ecloud requires linux/amd64 images for TEE deployment.

Image: ${imageRef}
Found platform(s): ${platforms.join(", ")}
Required platform: ${DOCKER_PLATFORM}

To fix this issue:
1. Manual fix:
   a. Rebuild your image with the correct platform:
      docker build --platform ${DOCKER_PLATFORM} -t ${imageRef} .
   b. Push the rebuilt image to your remote registry:
      docker push ${imageRef}

2. Or use the SDK to build with the correct platform automatically.`;

  return new Error(errorMsg);
}
