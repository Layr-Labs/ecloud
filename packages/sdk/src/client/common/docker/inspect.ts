/**
 * Docker image inspection
 */

import Docker from "dockerode";

import { DockerImageConfig } from "../types";

/**
 * Extract image configuration (CMD, ENTRYPOINT, USER)
 */
export async function extractImageConfig(
  docker: Docker,
  imageTag: string,
): Promise<DockerImageConfig> {
  try {
    const image = docker.getImage(imageTag);
    const inspect = await image.inspect();

    const config = inspect.Config || {};
    const cmd = config.Cmd || [];
    const entrypoint = config.Entrypoint || [];
    const user = config.User || "";
    const labels = config.Labels || {};

    // Use CMD if available, otherwise use ENTRYPOINT
    const originalCmd = cmd.length > 0 ? cmd : entrypoint;

    return {
      cmd: originalCmd as string[],
      entrypoint: entrypoint as string[],
      user: user,
      labels: labels,
    };
  } catch (error: any) {
    throw new Error(`Failed to inspect image ${imageTag}: ${error.message}`);
  }
}

/**
 * Check if image already has ecloud layering
 */
export async function checkIfImageAlreadyLayeredForECloud(
  docker: Docker,
  imageTag: string,
): Promise<boolean> {
  try {
    const config = await extractImageConfig(docker, imageTag);
    return "ECLOUD_cli_version" in config.labels;
  } catch {
    return false;
  }
}

/**
 * Pull Docker image
 */
export async function pullDockerImage(
  docker: Docker,
  imageTag: string,
  platform: string = "linux/amd64",
  logger?: { debug?: (msg: string) => void; info?: (msg: string) => void },
): Promise<void> {
  logger?.info?.(`Pulling image ${imageTag}...`);

  return new Promise((resolve, reject) => {
    docker.pull(imageTag, { platform }, (err, stream) => {
      if (err) {
        reject(new Error(`Failed to pull image ${imageTag}: ${err.message}`));
        return;
      }

      // Must consume the stream to ensure pull completes
      docker.modem.followProgress(
        stream!,
        (err) => {
          if (err) {
            reject(
              new Error(
                `Failed to complete image pull for ${imageTag}: ${err.message}`,
              ),
            );
          } else {
            logger?.info?.(`Image pull completed: ${imageTag}`);
            resolve();
          }
        },
        (event: any) => {
          // Log progress events
          if (event && event.status) {
            logger?.info?.(event.status);
          }
        },
      );
    });
  });
}
