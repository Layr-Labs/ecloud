/**
 * Docker build operations
 */

import * as child_process from "child_process";
import { promisify } from "util";
import { DOCKER_PLATFORM } from "../constants";
import { Logger } from "../types";

const exec = promisify(child_process.exec);

/**
 * Build Docker image using docker buildx
 * Streams output in real-time to logger
 */
export async function buildDockerImage(
  buildContext: string,
  dockerfilePath: string,
  tag: string,
  logger?: Logger,
): Promise<void> {
  const args = [
    "buildx",
    "build",
    "--platform",
    DOCKER_PLATFORM,
    "-t",
    tag,
    "-f",
    dockerfilePath,
    "--progress=plain",
    buildContext,
  ];

  logger?.info(`Building Docker image: ${tag}`);
  logger?.info(``);

  return new Promise<void>((resolve, reject) => {
    const process = child_process.spawn("docker", args, {
      cwd: buildContext,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    // Stream stdout to logger
    process.stdout?.on("data", (data: Buffer) => {
      const output = data.toString();
      stdout += output;
      // Log each line to info (Docker build output is important)
      output.split("\n").forEach((line) => {
        if (line.trim()) {
          logger?.info(line);
        }
      });
    });

    // Stream stderr to logger
    process.stderr?.on("data", (data: Buffer) => {
      const output = data.toString();
      stderr += output;
      // Log each line to info (Docker build output is important)
      output.split("\n").forEach((line) => {
        if (line.trim()) {
          logger?.info(line);
        }
      });
    });

    process.on("close", (code) => {
      if (code !== 0) {
        const errorMessage = stderr || stdout || "Unknown error";
        reject(new Error(`Docker build failed: ${errorMessage}`));
      } else {
        resolve();
      }
    });

    process.on("error", (error) => {
      reject(new Error(`Failed to start Docker build: ${error.message}`));
    });
  });
}

/**
 * Check if Docker is running
 */
export async function isDockerRunning(): Promise<boolean> {
  try {
    await exec("docker info");
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure Docker is running, throw error if not
 */
export async function ensureDockerIsRunning(): Promise<void> {
  const running = await isDockerRunning();
  if (!running) {
    throw new Error(
      "Docker is not running. Please start Docker and try again.",
    );
  }
}
