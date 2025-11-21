/**
 * Git template fetching
 *
 * Fetches templates from Git repositories
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { Logger } from "../../../../common/types";

const execAsync = promisify(exec);

export interface GitFetcherConfig {
  verbose: boolean;
}

/**
 * Fetch full template repository
 */
export async function fetchTemplate(
  repoURL: string,
  ref: string,
  targetDir: string,
  config: GitFetcherConfig,
  logger: Logger,
): Promise<void> {
  if (!repoURL) {
    throw new Error("repoURL is required");
  }

  logger.info(`\nCloning repo: ${repoURL} → ${targetDir}\n`);

  try {
    // Clone with no checkout
    await execAsync(
      `git clone --no-checkout --progress ${repoURL} ${targetDir}`,
      {
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    // Checkout the desired ref
    await execAsync(`git -C ${targetDir} checkout --quiet ${ref}`);

    // Update submodules
    await execAsync(
      `git -C ${targetDir} submodule update --init --recursive --progress`,
    );

    logger.info(`Clone repo complete: ${repoURL}\n`);
  } catch (error: any) {
    throw new Error(`Failed to clone repository: ${error.message}`);
  }
}

/**
 * Fetch subdirectory from template repository using sparse checkout
 */
export async function fetchTemplateSubdirectory(
  repoURL: string,
  ref: string,
  subPath: string,
  targetDir: string,
  logger: Logger,
): Promise<void> {
  if (!repoURL) {
    throw new Error("repoURL is required");
  }
  if (!subPath) {
    throw new Error("subPath is required");
  }

  // Create temporary directory for sparse clone
  let tempDir: string;
  try {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "eigenx-template-"));
  } catch {
    // If that fails, try ~/.eigenx/tmp
    const homeDir = os.homedir();
    const fallbackBase = path.join(homeDir, ".eigenx", "tmp");
    fs.mkdirSync(fallbackBase, { recursive: true });
    tempDir = fs.mkdtempSync(path.join(fallbackBase, "eigenx-template-"));
  }

  try {
    logger.info(`\nCloning template: ${repoURL} → extracting ${subPath}\n`);

    // Clone with sparse checkout
    await cloneSparse(repoURL, ref, subPath, tempDir);

    // Verify subdirectory exists
    const srcPath = path.join(tempDir, subPath);
    if (!fs.existsSync(srcPath)) {
      throw new Error(
        `Template subdirectory ${subPath} not found in ${repoURL}`,
      );
    }

    // Copy subdirectory contents to target
    await copyDirectory(srcPath, targetDir);

    logger.info(`Template extraction complete: ${subPath}\n`);
  } finally {
    // Cleanup temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Clone repository with sparse checkout
 */
async function cloneSparse(
  repoURL: string,
  ref: string,
  subPath: string,
  tempDir: string,
  // config: GitFetcherConfig
): Promise<void> {
  try {
    // Initialize git repository
    await execAsync(`git init ${tempDir}`);

    // Add remote
    await execAsync(`git -C ${tempDir} remote add origin ${repoURL}`);

    // Enable sparse checkout
    await execAsync(`git -C ${tempDir} config core.sparseCheckout true`);

    // Set sparse checkout path
    const sparseCheckoutPath = path.join(tempDir, ".git/info/sparse-checkout");
    fs.writeFileSync(sparseCheckoutPath, `${subPath}\n`);

    // Fetch and checkout
    await execAsync(`git -C ${tempDir} fetch origin ${ref}`);

    await execAsync(`git -C ${tempDir} checkout ${ref}`);
  } catch (error: any) {
    throw new Error(`Failed to clone sparse repository: ${error.message}`);
  }
}

/**
 * Copy directory recursively
 */
async function copyDirectory(src: string, dst: string): Promise<void> {
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(dstPath, { recursive: true });
      await copyDirectory(srcPath, dstPath);
    } else {
      const stat = fs.statSync(srcPath);
      fs.copyFileSync(srcPath, dstPath);
      fs.chmodSync(dstPath, stat.mode);
    }
  }
}
