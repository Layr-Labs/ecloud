/**
 * Main deploy function
 * 
 * This is the main entry point for deploying applications to ecloud TEE.
 * It orchestrates all the steps: build, push, encrypt, and deploy on-chain.
 */

import { DeployOptions, DeployResult, Logger } from './types';
import { getEnvironmentConfig } from './config/environment';
import { ensureDockerIsRunning } from './docker/build';
import { prepareRelease } from './release/prepare';
import { deployApp } from './contract/caller';
import { watchUntilRunning } from './contract/watcher';

/**
 * Default logger (console-based)
 */
const defaultLogger: Logger = {
  debug: (...args) => console.debug(...args),
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

/**
 * Deploy an application to ecloud TEE
 */
export async function deploy(
  options: DeployOptions,
  logger: Logger = defaultLogger
): Promise<DeployResult> {
  logger.info('Starting deployment...');

  // 1. Preflight checks
  logger.debug('Performing preflight checks...');
  const environmentConfig = getEnvironmentConfig(options.environment);
  
  // 2. Ensure Docker is running
  logger.debug('Checking Docker...');
  await ensureDockerIsRunning();

  // 3. Generate random salt for app ID
  const salt = generateRandomSalt();
  logger.debug(`Generated salt: ${Buffer.from(salt).toString('hex')}`);

  // 4. Calculate app ID (requires contract interaction)
  const appID = await calculateAppID(
    options.privateKey,
    options.rpcUrl,
    environmentConfig,
    salt
  );
  logger.info(`App ID: ${appID}`);

  // 5. Prepare release (build, push, encrypt)
  logger.info('Preparing release...');
  const { release, finalImageRef } = await prepareRelease(
    {
      dockerfilePath: options.dockerfilePath,
      imageRef: options.imageRef,
      envFilePath: options.envFilePath,
      logRedirect: options.logRedirect,
      instanceType: options.instanceType,
      environmentConfig,
      appID,
    },
    logger
  );

  // 6. Deploy on-chain
  logger.info('Deploying on-chain...');
  const { appAddress: deployedAppID, txHash } = await deployApp(
    {
      privateKey: options.privateKey,
      rpcUrl: options.rpcUrl,
      environmentConfig,
      salt,
      release,
      publicLogs: options.publicLogs,
      imageRef: finalImageRef,
    },
    logger
  );

  // 7. Watch until running
  logger.info('Waiting for app to start...');
  const ipAddress = await watchUntilRunning(
    {
      privateKey: options.privateKey,
      rpcUrl: options.rpcUrl,
      environmentConfig,
      appID: deployedAppID,
    },
    logger
  );

  return {
    appID: deployedAppID,
    appName: options.appName || '',
    imageRef: finalImageRef,
    ipAddress,
    txHash,
  };
}

/**
 * Generate random 32-byte salt
 */
function generateRandomSalt(): Uint8Array {
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  return salt;
}

/**
 * Calculate app ID from owner address and salt
 */
async function calculateAppID(
  privateKey: string,
  rpcUrl: string,
  environmentConfig: any,
  salt: Uint8Array
): Promise<string> {
  // Import calculateAppID from contract caller
  const { calculateAppID } = await import('./contract/caller');
  return calculateAppID(
    privateKey as `0x${string}`,
    rpcUrl,
    environmentConfig,
    salt
  );
}

