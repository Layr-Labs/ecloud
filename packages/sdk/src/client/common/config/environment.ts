/**
 * Environment configuration for different networks
 */

import { BillingEnvironmentConfig, EnvironmentConfig } from "../types";

// Chain IDs
export const SEPOLIA_CHAIN_ID = 11155111;
export const MAINNET_CHAIN_ID = 1;

// Common addresses across all chains
export const CommonAddresses: Record<string, string> = {
  ERC7702Delegator: "0x63c0c19a282a1b52b07dd5a65b58948a07dae32b",
};

// Addresses specific to each chain
export const ChainAddresses: Record<number, Record<string, string>> = {
  [MAINNET_CHAIN_ID]: {
    PermissionController: "0x25E5F8B1E7aDf44518d35D5B2271f114e081f0E5",
  },
  [SEPOLIA_CHAIN_ID]: {
    PermissionController: "0x44632dfBdCb6D3E21EF613B0ca8A6A0c618F5a37",
  },
};

// Billing environment configurations (separate from chain environments)
const BILLING_ENVIRONMENTS: Record<"dev" | "prod", BillingEnvironmentConfig> = {
  dev: {
    billingApiServerURL: "http://136.110.145.244",
  },
  prod: {
    billingApiServerURL: "https://billingapi.eigencloud.xyz",
  },
};

// Chain environment configurations
const ENVIRONMENTS: Record<string, Omit<EnvironmentConfig, "chainID">> = {
  "sepolia-dev": {
    name: "sepolia",
    build: "dev",
    appControllerAddress: "0xa86DC1C47cb2518327fB4f9A1627F51966c83B92",
    permissionControllerAddress:
      ChainAddresses[SEPOLIA_CHAIN_ID].PermissionController,
    erc7702DelegatorAddress: CommonAddresses.ERC7702Delegator,
    kmsServerURL: "http://10.128.0.57:8080",
    userApiServerURL: "https://userapi-compute-sepolia-dev.eigencloud.xyz",
    defaultRPCURL: "https://ethereum-sepolia-rpc.publicnode.com",
  },
  "sepolia": {
    name: "sepolia",
    build: "prod",
    appControllerAddress: "0x0dd810a6ffba6a9820a10d97b659f07d8d23d4E2",
    permissionControllerAddress:
      ChainAddresses[SEPOLIA_CHAIN_ID].PermissionController,
    erc7702DelegatorAddress: CommonAddresses.ERC7702Delegator,
    kmsServerURL: "http://10.128.15.203:8080",
    userApiServerURL: "https://userapi-compute-sepolia-prod.eigencloud.xyz",
    defaultRPCURL: "https://ethereum-sepolia-rpc.publicnode.com",
  },
  "mainnet-alpha": {
    name: "mainnet-alpha",
    build: "prod",
    appControllerAddress: "0xc38d35Fc995e75342A21CBd6D770305b142Fbe67",
    permissionControllerAddress:
      ChainAddresses[MAINNET_CHAIN_ID].PermissionController,
    erc7702DelegatorAddress: CommonAddresses.ERC7702Delegator,
    kmsServerURL: "http://10.128.0.2:8080",
    userApiServerURL: "https://userapi-compute.eigencloud.xyz",
    defaultRPCURL: "https://ethereum-rpc.publicnode.com",
  },
};

const CHAIN_ID_TO_ENVIRONMENT: Record<string, string> = {
  [SEPOLIA_CHAIN_ID.toString()]: "sepolia",
  [MAINNET_CHAIN_ID.toString()]: "mainnet-alpha",
};

/**
 * Get environment configuration
 */
export function getEnvironmentConfig(
  environment: string,
  chainID?: bigint,
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
        `Environment ${environment} does not match chain ID ${chainID}`,
      );
    }
  }

  // Determine chain ID from environment if not provided
  const resolvedChainID =
    chainID ||
    (env.name === "sepolia" ? SEPOLIA_CHAIN_ID : MAINNET_CHAIN_ID);

  return {
    ...env,
    chainID: BigInt(resolvedChainID),
  };
}

/**
 * Get billing environment configuration
 * @param build - The build type ("dev" or "prod")
 */
export function getBillingEnvironmentConfig(
  build: "dev" | "prod",
): { billingApiServerURL: string } {
  const config = BILLING_ENVIRONMENTS[build];
  if (!config) {
    throw new Error(`Unknown billing environment: ${build}`);
  }
  return config;
}

/**
 * Detect environment from chain ID
 */
export function detectEnvironmentFromChainID(
  chainID: bigint,
): string | undefined {
  return CHAIN_ID_TO_ENVIRONMENT[chainID.toString()];
}
