/**
 * Docker push operations
 */

import Docker from "dockerode";

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as child_process from "child_process";

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Extract hostname from a registry URL/string for safe comparison
 */
function extractHostname(registry: string): string {
  let hostname = registry.replace(/^https?:\/\//, "");
  hostname = hostname.split("/")[0];
  hostname = hostname.split(":")[0];
  return hostname.toLowerCase();
}

/**
 * Check if a registry matches Docker Hub
 */
function isDockerHub(registry: string): boolean {
  const hostname = extractHostname(registry);
  return (
    hostname === "docker.io" ||
    hostname === "index.docker.io" ||
    hostname === "registry-1.docker.io"
  );
}

/**
 * Check if a registry matches Google Container Registry
 */
function isGCR(registry: string): boolean {
  const hostname = extractHostname(registry);
  return hostname === "gcr.io" || hostname.endsWith(".gcr.io");
}

/**
 * Extract registry from image reference
 */
export function extractRegistry(imageRef: string): string {
  // Handle different registry formats:
  // - docker.io/library/image:tag
  // - ghcr.io/owner/image:tag
  // - gcr.io/project/image:tag
  // - registry.example.com/image:tag

  const parts = imageRef.split("/");
  if (parts.length < 2) {
    return "docker.io"; // Default to Docker Hub
  }

  const firstPart = parts[0];

  // Check if first part is a registry (contains . or is a known registry)
  if (firstPart.includes(".") || firstPart === "ghcr.io" || isGCR(firstPart)) {
    return firstPart;
  }

  // Default to Docker Hub
  return "docker.io";
}

/**
 * Get auth config for a specific registry
 * Returns an object with username/password or auth string
 * Handles both direct auth in config.json and credential stores
 */
export async function getRegistryAuthConfig(
  registry: string,
): Promise<{ username?: string; password?: string; auth?: string } | undefined> {
  const authConfig = getDockerAuthConfig();

  // Helper to extract auth from config entry
  const extractAuth = (auth: any) => {
    if (!auth) return undefined;
    // If auth string exists, use it
    if (auth.auth) {
      return { auth: auth.auth };
    }
    // If username and password exist, use them
    if (auth.username && auth.password) {
      return { username: auth.username, password: auth.password };
    }
    return undefined;
  };

  // Try exact match first
  const exactMatch = extractAuth(authConfig[registry]);
  if (exactMatch) return exactMatch;

  // Try with https:// prefix
  const httpsRegistry = `https://${registry}`;
  const httpsMatch = extractAuth(authConfig[httpsRegistry]);
  if (httpsMatch) return httpsMatch;

  // For ghcr.io, also try common variants
  if (registry === "ghcr.io") {
    const ghcrVariants = ["ghcr.io", "https://ghcr.io", "https://ghcr.io/v1/"];
    for (const variant of ghcrVariants) {
      const match = extractAuth(authConfig[variant]);
      if (match) return match;

      // If entry exists but is empty (credential store), try to get from helper
      if (authConfig[variant] && Object.keys(authConfig[variant]).length === 0) {
        const creds = await getCredentialsFromHelper("ghcr.io");
        if (creds) {
          return { username: creds.username, password: creds.password };
        }
      }
    }

    // Also try to get from helper even if no entry exists (for credential store only setups)
    const creds = await getCredentialsFromHelper("ghcr.io");
    if (creds) {
      return { username: creds.username, password: creds.password };
    }
  }

  // For Docker Hub, try common variants
  if (isDockerHub(registry)) {
    const dockerVariants = [
      "https://index.docker.io/v1/",
      "https://index.docker.io/v1",
      "index.docker.io",
      "docker.io",
    ];
    for (const variant of dockerVariants) {
      const match = extractAuth(authConfig[variant]);
      if (match) return match;
    }
  }

  return undefined;
}

/**
 * Push Docker image to registry
 * Uses Docker CLI directly for better credential helper support
 * Streams output in real-time to logger
 */
export async function pushDockerImage(
  docker: Docker,
  imageRef: string,
  logger?: { debug?: (msg: string) => void; info?: (msg: string) => void },
): Promise<void> {
  // Use Docker CLI directly instead of dockerode for better credential helper support
  // Docker CLI automatically handles credential helpers, which dockerode sometimes struggles with
  logger?.info?.(`Pushing image ${imageRef}...`);

  return new Promise<void>((resolve, reject) => {
    const process = child_process.spawn("docker", ["push", imageRef], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    // Stream stdout to logger
    process.stdout?.on("data", (data: Buffer) => {
      const output = data.toString();
      stdout += output;
      // Log each line to info (Docker push output shows progress)
      output.split("\n").forEach((line) => {
        if (line.trim()) {
          logger?.info?.(line);
        }
      });
    });

    // Stream stderr to logger
    process.stderr?.on("data", (data: Buffer) => {
      const output = data.toString();
      stderr += output;
      // Log each line to info (Docker push output shows progress)
      output.split("\n").forEach((line) => {
        if (line.trim()) {
          logger?.info?.(line);
        }
      });
    });

    process.on("close", async (code) => {
      if (code !== 0) {
        const errorMsg = stderr || stdout || "Unknown error";
        if (isPermissionError(errorMsg)) {
          reject(new PushPermissionError(imageRef, new Error(errorMsg)));
        } else {
          reject(new Error(`Docker push failed: ${errorMsg}`));
        }
        return;
      }

      // Check for success indicators
      const output = stdout + stderr;
      if (!output.includes("digest:") && !output.includes("pushed") && !output.includes("Pushed")) {
        logger?.debug?.("No clear success indicator in push output, verifying...");
      }

      // Verify the push by checking if image exists in registry
      try {
        await verifyImageExists(imageRef, logger);
        logger?.info?.("Image push completed successfully");
        resolve();
      } catch (error: any) {
        reject(error);
      }
    });

    process.on("error", (error) => {
      const msg = error.message || String(error);
      if (msg.includes("command not found") || msg.includes("ENOENT")) {
        reject(
          new Error(`Docker CLI not found. Please ensure Docker is installed and in your PATH.`),
        );
      } else {
        reject(new Error(`Failed to start Docker push: ${msg}`));
      }
    });
  });
}

/**
 * Verify that the image exists in the registry after push
 */
async function verifyImageExists(
  imageRef: string,
  logger?: { debug?: (msg: string) => void; info?: (msg: string) => void },
): Promise<void> {
  // Wait longer for registry to process (GHCR can be slow)
  logger?.debug?.("Waiting for registry to process image...");
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Retry verification up to 5 times with increasing delays
  let retries = 5;

  while (retries > 0) {
    try {
      await execFileAsync("docker", ["manifest", "inspect", imageRef], {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 10000, // 10 second timeout
      });
      // If we get here, the image exists
      logger?.debug?.("Image verified in registry");
      return;
    } catch (error: any) {
      const errorMsg = error.message || String(error);

      // If manifest inspect fails, wait and retry
      if (errorMsg.includes("manifest unknown") || errorMsg.includes("not found")) {
        retries--;
        if (retries > 0) {
          const waitTime = (6 - retries) * 2000; // 2s, 4s, 6s, 8s, 10s
          logger?.debug?.(
            `Image not found yet, retrying in ${waitTime / 1000}s... (${retries} retries left)`,
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue;
        }
        // All retries exhausted
        throw new Error(
          `Image push verification failed: Image ${imageRef} was not found in registry after multiple attempts.\n` +
            `This usually means the push failed. Please check:\n` +
            `1. Your authentication: docker login ghcr.io\n` +
            `2. Your permissions: Ensure you have push access to the repository\n` +
            `3. Try pushing manually: docker push ${imageRef}\n` +
            `4. Check if the image exists: docker manifest inspect ${imageRef}`,
        );
      }
      // Other errors might be temporary (network issues, etc.)
      // Retry once more
      retries--;
      if (retries > 0) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }
      // Log a warning but don't fail for non-manifest-unknown errors
      logger?.debug?.(`Warning: Could not verify image push: ${errorMsg}`);
      return;
    }
  }
}

/**
 * Check if error message indicates a permission/auth issue
 */
function isPermissionError(errMsg: string): boolean {
  const errLower = errMsg.toLowerCase();
  const permissionKeywords = [
    "denied",
    "unauthorized",
    "forbidden",
    "insufficient_scope",
    "authentication required",
    "access forbidden",
    "permission denied",
    "requested access to the resource is denied",
  ];

  return permissionKeywords.some((keyword) => errLower.includes(keyword));
}

/**
 * Push permission error class
 */
export class PushPermissionError extends Error {
  constructor(
    public imageRef: string,
    public originalError: Error,
  ) {
    super(`Permission denied pushing to ${imageRef}: ${originalError.message}`);
    this.name = "PushPermissionError";
  }
}

/**
 * Get Docker auth config from system
 * This reads from ~/.docker/config.json and handles credential stores
 */
export function getDockerAuthConfig(): Record<string, any> {
  const dockerConfigPath = path.join(os.homedir(), ".docker", "config.json");

  if (!fs.existsSync(dockerConfigPath)) {
    return {};
  }

  try {
    const config = JSON.parse(fs.readFileSync(dockerConfigPath, "utf-8"));
    const auths = config.auths || {};

    // If credsStore is set, credentials are stored in credential helper (e.g., osxkeychain)
    // In this case, dockerode should handle auth automatically, but we still return
    // the auths structure (even if empty) to indicate the registry is configured
    if (config.credsStore) {
      // Return auths as-is (may be empty objects, but registry is configured)
      return auths;
    }

    return auths;
  } catch {
    return {};
  }
}

/**
 * Get credentials from Docker credential helper
 */
async function getCredentialsFromHelper(
  registry: string,
): Promise<{ username: string; password: string } | undefined> {
  const dockerConfigPath = path.join(os.homedir(), ".docker", "config.json");

  if (!fs.existsSync(dockerConfigPath)) {
    return undefined;
  }

  try {
    const config = JSON.parse(fs.readFileSync(dockerConfigPath, "utf-8"));
    const credsStore = config.credsStore;

    if (!credsStore) {
      return undefined;
    }

    // Use Docker credential helper to get credentials
    // Format: docker-credential-<helper> get <serverURL>
    const { execSync } = await import("child_process");
    const helper = `docker-credential-${credsStore}`;

    try {
      const output = execSync(`echo "${registry}" | ${helper} get`, {
        encoding: "utf-8",
      });
      const creds = JSON.parse(output);
      if (creds.Username && creds.Secret) {
        return { username: creds.Username, password: creds.Secret };
      }
    } catch {
      // Credential helper failed, return undefined
      return undefined;
    }
  } catch {
    return undefined;
  }

  return undefined;
}
