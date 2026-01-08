/**
 * Image registry operations - digest extraction
 *
 * Uses Docker API to extract image digest and validate platform
 */

import * as child_process from "child_process";
import { promisify } from "util";
import { ImageDigestResult } from "../types";
import { DOCKER_PLATFORM } from "../constants";

const execFileAsync = promisify(child_process.execFile);

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
export async function getImageDigestAndName(imageRef: string): Promise<ImageDigestResult> {
  try {
    // Use docker manifest inspect to get the manifest safely
    const { stdout } = await execFileAsync(
      "docker",
      ["manifest", "inspect", imageRef],
      { maxBuffer: 10 * 1024 * 1024 }, // 10MB buffer
    );

    const manifest: Manifest = JSON.parse(stdout);

    // Check if it's a multi-platform manifest (index)
    if (manifest.manifests && manifest.manifests.length > 0) {
      return extractDigestFromMultiPlatform(manifest, imageRef);
    } else {
      // Single-platform image
      return extractDigestFromSinglePlatform(manifest, imageRef);
    }
  } catch (error: any) {
    throw new Error(`Failed to get image digest for ${imageRef}: ${error.message}`);
  }
}

/**
 * Extract digest from multi-platform image index
 */
function extractDigestFromMultiPlatform(manifest: Manifest, imageRef: string): ImageDigestResult {
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
    const { stdout } = await execFileAsync("docker", ["inspect", imageRef], {
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
  if ([...name].filter((c) => c === "/").length === 1) {
    name = `docker.io/${name}`;
  }

  // Default registry
  return name;
}

/**
 * Create platform error message
 */
function createPlatformErrorMessage(imageRef: string, platforms: string[]): Error {
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

// ============================================================================
// HTTP-based digest fetching (headless mode - no Docker required)
// ============================================================================

interface ParsedImageRef {
  registry: string;
  repository: string;
  tag: string;
}

/**
 * Parse image reference into components.
 * e.g., "ghcr.io/user/repo:v1" -> { registry: "ghcr.io", repository: "user/repo", tag: "v1" }
 */
function parseImageRef(imageRef: string): ParsedImageRef {
  let ref = imageRef;

  // Remove digest if present
  const digestIdx = ref.indexOf("@");
  if (digestIdx !== -1) {
    ref = ref.substring(0, digestIdx);
  }

  // Extract tag (default to "latest")
  let tag = "latest";
  const tagIdx = ref.lastIndexOf(":");
  if (tagIdx !== -1 && !ref.substring(tagIdx + 1).includes("/")) {
    tag = ref.substring(tagIdx + 1);
    ref = ref.substring(0, tagIdx);
  }

  const parts = ref.split("/");
  let registry: string;
  let repository: string;

  if (parts.length === 1) {
    // e.g., "nginx" -> docker.io/library/nginx
    registry = "registry-1.docker.io";
    repository = `library/${parts[0]}`;
  } else if (parts.length === 2 && !parts[0].includes(".") && !parts[0].includes(":")) {
    // e.g., "user/repo" -> docker.io/user/repo
    registry = "registry-1.docker.io";
    repository = ref;
  } else {
    // e.g., "ghcr.io/user/repo"
    registry = parts[0];
    repository = parts.slice(1).join("/");
  }

  return { registry, repository, tag };
}

/**
 * Get auth token for Docker Hub (required even for public images).
 */
async function getDockerHubToken(repository: string): Promise<string> {
  const url = `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repository}:pull`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to get Docker Hub token: ${response.statusText}`);
  }
  const data = (await response.json()) as { token: string };
  return data.token;
}

/**
 * Fetch manifest from registry via HTTP.
 */
async function fetchManifestHttp(
  registry: string,
  repository: string,
  tag: string,
): Promise<{ manifest: Manifest; digest?: string }> {
  const registryUrl =
    registry === "registry-1.docker.io" ? "https://registry-1.docker.io" : `https://${registry}`;

  const url = `${registryUrl}/v2/${repository}/manifests/${tag}`;

  const headers: Record<string, string> = {
    Accept: [
      "application/vnd.docker.distribution.manifest.list.v2+json",
      "application/vnd.oci.image.index.v1+json",
      "application/vnd.docker.distribution.manifest.v2+json",
      "application/vnd.oci.image.manifest.v1+json",
    ].join(", "),
  };

  // Docker Hub requires auth token
  if (registry === "registry-1.docker.io") {
    const token = await getDockerHubToken(repository);
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Failed to fetch manifest: ${response.status} ${response.statusText}`);
  }

  const manifest = (await response.json()) as Manifest;
  const digest = response.headers.get("docker-content-digest") || undefined;

  return { manifest, digest };
}

/**
 * Fetch image digest via HTTP registry API (no Docker required).
 *
 * Use this for headless deployments where Docker is not available.
 * Works with public images on Docker Hub, GHCR, and other registries.
 *
 * @param imageRef - Image reference (e.g., "ghcr.io/org/app:v1" or "nginx:latest")
 * @returns Image digest in format "sha256:abc123..."
 *
 * @example
 * ```typescript
 * const digest = await fetchImageDigest("ghcr.io/myorg/myapp:v1.0.0");
 * // digest = "sha256:abc123..."
 *
 * await deploy({
 *   imageRef: "ghcr.io/myorg/myapp:v1.0.0",
 *   imageDigest: digest,  // Enables headless mode
 *   appName: "my-app",
 *   // ...
 * });
 * ```
 */
export async function fetchImageDigest(imageRef: string): Promise<string> {
  const { registry, repository, tag } = parseImageRef(imageRef);
  const { manifest, digest: headerDigest } = await fetchManifestHttp(registry, repository, tag);

  // Check if multi-platform manifest
  if (manifest.manifests && manifest.manifests.length > 0) {
    // Find linux/amd64 platform
    for (const m of manifest.manifests) {
      if (m.platform && `${m.platform.os}/${m.platform.architecture}` === DOCKER_PLATFORM) {
        return m.digest;
      }
    }
    const platforms = manifest.manifests
      .filter((m) => m.platform)
      .map((m) => `${m.platform!.os}/${m.platform!.architecture}`);
    throw createPlatformErrorMessage(imageRef, platforms);
  }

  // Single manifest - use header digest or config digest
  if (headerDigest) {
    return headerDigest;
  }
  if (manifest.config?.digest) {
    return manifest.config.digest;
  }

  throw new Error(`Could not extract digest from manifest for ${imageRef}`);
}
