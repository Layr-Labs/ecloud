/**
 * Environment configuration for different networks
 */

import { EnvironmentConfig } from '../types';

// Chain IDs
export const SEPOLIA_CHAIN_ID = 11155111n;
export const MAINNET_CHAIN_ID = 1n;

// Environment configurations
const ENVIRONMENTS: Record<string, Omit<EnvironmentConfig, 'chainID'>> = {
  sepolia: {
    name: 'sepolia',
    appControllerAddress: '0x...', // TODO: Add actual addresses
    permissionControllerAddress: '0x...',
    erc7702DelegatorAddress: '0x...',
    kmsServerURL: 'https://kms.sepolia.eigencloud.xyz',
    userApiServerURL: 'https://api.sepolia.eigencloud.xyz',
  },
  'mainnet-alpha': {
    name: 'mainnet-alpha',
    appControllerAddress: '0x...', // TODO: Add actual addresses
    permissionControllerAddress: '0x...',
    erc7702DelegatorAddress: '0x...',
    kmsServerURL: 'https://kms.eigencloud.xyz',
    userApiServerURL: 'https://api.eigencloud.xyz',
  },
};

const CHAIN_ID_TO_ENVIRONMENT: Record<string, string> = {
  [SEPOLIA_CHAIN_ID.toString()]: 'sepolia',
  [MAINNET_CHAIN_ID.toString()]: 'mainnet-alpha',
};

/**
 * Get environment configuration
 */
export function getEnvironmentConfig(
  environment: string,
  chainID?: bigint
): EnvironmentConfig {
  const env = ENVIRONMENTS[environment];
  if (!env) {
    throw new Error(`Unknown environment: ${environment}`);
  }

  // If chainID provided, validate it matches
  if (chainID) {
    const expectedEnv = CHAIN_ID_TO_ENVIRONMENT[chainID.toString()];
    if (expectedEnv && expectedEnv !== environment) {
      throw new Error(
        `Environment ${environment} does not match chain ID ${chainID}`
      );
    }
  }

  // Determine chain ID from environment if not provided
  const resolvedChainID =
    chainID ||
    (environment === 'sepolia' ? SEPOLIA_CHAIN_ID : MAINNET_CHAIN_ID);

  return {
    ...env,
    chainID: resolvedChainID,
  };
}

/**
 * Detect environment from chain ID
 */
export function detectEnvironmentFromChainID(
  chainID: bigint
): string | undefined {
  return CHAIN_ID_TO_ENVIRONMENT[chainID.toString()];
}

