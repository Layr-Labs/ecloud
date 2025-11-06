/**
 * Docker build operations
 */

import * as child_process from 'child_process';
import { promisify } from 'util';
import { DOCKER_PLATFORM } from '../constants';
import { Logger } from '../types';

const exec = promisify(child_process.exec);

/**
 * Build Docker image using docker buildx
 */
export async function buildDockerImage(
  buildContext: string,
  dockerfilePath: string,
  tag: string,
  logger?: Logger
): Promise<void> {
  const command = [
    'docker',
    'buildx',
    'build',
    '--platform',
    DOCKER_PLATFORM,
    '-t',
    tag,
    '-f',
    dockerfilePath,
    '--progress=plain',
    buildContext,
  ].join(' ');

  logger?.info(`Building Docker image: ${tag}`);

  try {
    const { stdout, stderr } = await exec(command, {
      cwd: buildContext,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    if (stdout) {
      logger?.debug(stdout);
    }
    if (stderr) {
      logger?.warn(stderr);
    }
  } catch (error: any) {
    const errorMessage = error.stderr || error.message || 'Unknown error';
    throw new Error(`Docker build failed: ${errorMessage}`);
  }
}

/**
 * Check if Docker is running
 */
export async function isDockerRunning(): Promise<boolean> {
  try {
    await exec('docker info');
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
      'Docker is not running. Please start Docker and try again.'
    );
  }
}

