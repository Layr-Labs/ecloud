/**
 * Identity-aware transaction utilities for CLI commands
 *
 * Shared logic for reading the active identity and formatting results.
 */

import {
  sendWithIdentity,
  formatTransactionResult,
  type TransactionResult,
  type IdentityRouterOptions,
} from "@layr-labs/ecloud-sdk";
import {
  getActiveIdentity,
  getIdentities,
  type StoredIdentity,
} from "./globalConfig";
import type { Address, Hex, PublicClient, WalletClient } from "viem";
import type { EnvironmentConfig } from "@layr-labs/ecloud-sdk";
import chalk from "chalk";

/**
 * Get the active identity for the current environment.
 * Falls back to EOA (signing key address) if no identity is configured.
 */
export function getActiveIdentityOrEOA(environment: string, eoaAddress: string): StoredIdentity {
  const active = getActiveIdentity(environment);
  if (active) return active;

  // No active identity — fall back to EOA
  return { type: "eoa", address: eoaAddress };
}

/**
 * Execute a transaction using the active identity.
 * Routes to direct send, Safe proposal, or Timelock schedule based on identity type.
 */
export async function executeWithIdentity(options: {
  environment: string;
  eoaAddress: string;
  walletClient: WalletClient;
  publicClient: PublicClient;
  environmentConfig: any;
  to: Address;
  data: Hex;
  value?: bigint;
  pendingMessage?: string;
  txDescription?: string;
  gas?: any;
}): Promise<TransactionResult> {
  const identity = getActiveIdentityOrEOA(options.environment, options.eoaAddress);

  return sendWithIdentity({
    identity: {
      type: identity.type,
      address: identity.address,
      delay: identity.delay,
      safeAddress: identity.safeAddress,
    },
    walletClient: options.walletClient,
    publicClient: options.publicClient,
    environmentConfig: options.environmentConfig,
    to: options.to,
    data: options.data,
    value: options.value,
    environment: options.environment,
    pendingMessage: options.pendingMessage,
    txDescription: options.txDescription,
    gas: options.gas,
  });
}

/**
 * Print the result of an identity-aware transaction
 */
export function printTransactionResult(
  result: TransactionResult,
  log: (msg: string) => void,
): void {
  const lines = formatTransactionResult(result);
  for (const line of lines) {
    log(line);
  }
}

/**
 * Print a warning about which identity will be used for this transaction
 */
export function printIdentityContext(
  environment: string,
  eoaAddress: string,
  log: (msg: string) => void,
): StoredIdentity {
  const identity = getActiveIdentityOrEOA(environment, eoaAddress);

  switch (identity.type) {
    case "eoa":
      log(chalk.gray(`Identity: EOA ${identity.address.slice(0, 6)}...${identity.address.slice(-4)} (direct transaction)`));
      break;
    case "safe":
      log(chalk.gray(`Identity: Safe ${identity.address.slice(0, 6)}...${identity.address.slice(-4)} (will propose to Safe)`));
      break;
    case "timelock":
      if (identity.safeAddress) {
        log(chalk.gray(`Identity: Timelock(Safe) ${identity.address.slice(0, 6)}...${identity.address.slice(-4)} (will propose schedule to Safe)`));
      } else {
        log(chalk.gray(`Identity: Timelock ${identity.address.slice(0, 6)}...${identity.address.slice(-4)} (will schedule with ${identity.delay || "24h"} delay)`));
      }
      break;
  }

  return identity;
}
