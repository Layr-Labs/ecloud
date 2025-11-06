/**
 * Docker push operations
 */

import Docker from 'dockerode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Push Docker image to registry
 */
export async function pushDockerImage(
  docker: Docker,
  imageRef: string
): Promise<void> {
  const image = docker.getImage(imageRef);

  try {
    // dockerode's types say ReadableStream (web), but runtime is a Node stream.
    const stream = (await image.push({})) as unknown as NodeJS.ReadableStream;

    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(
        stream,
        (err?: any) => {
          if (err) {
            const msg = String(err?.message ?? err);
            if (isPermissionError(msg)) {
              reject(new PushPermissionError(imageRef, new Error(msg)));
            } else {
              reject(new Error(`Failed to complete image push for ${imageRef}: ${msg}`));
            }
            return;
          }
          resolve();
        }
      );
    });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (isPermissionError(msg)) {
      throw new PushPermissionError(imageRef, new Error(msg));
    }
    throw new Error(`Failed to push image ${imageRef}: ${msg}`);
  }
}

/**
 * Check if error message indicates a permission/auth issue
 */
function isPermissionError(errMsg: string): boolean {
  const errLower = errMsg.toLowerCase();
  const permissionKeywords = [
    'denied',
    'unauthorized',
    'forbidden',
    'insufficient_scope',
    'authentication required',
    'access forbidden',
    'permission denied',
    'requested access to the resource is denied',
  ];

  return permissionKeywords.some((keyword) => errLower.includes(keyword));
}

/**
 * Push permission error class
 */
export class PushPermissionError extends Error {
  constructor(
    public imageRef: string,
    public originalError: Error
  ) {
    super(`Permission denied pushing to ${imageRef}: ${originalError.message}`);
    this.name = 'PushPermissionError';
  }
}

/**
 * Get Docker auth config from system
 * This reads from ~/.docker/config.json
 */
export function getDockerAuthConfig(): Record<string, any> {
  const dockerConfigPath = path.join(
    os.homedir(),
    '.docker',
    'config.json'
  );

  if (!fs.existsSync(dockerConfigPath)) {
    return {};
  }

  try {
    const config = JSON.parse(fs.readFileSync(dockerConfigPath, 'utf-8'));
    return config.auths || {};
  } catch {
    return {};
  }
}
