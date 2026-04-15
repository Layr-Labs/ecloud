/**
 * Identity-aware transaction routing
 *
 * Routes transactions based on the active identity type:
 * - EOA: sign and send directly
 * - Safe: propose via Safe Transaction Service
 * - Timelock(EOA): schedule on Timelock, then execute after delay
 * - Timelock(Safe): propose schedule to Safe, then propose execute after delay
 */

import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  encodeFunctionData,
} from "viem";
import { proposeSafeTransaction, type SafeProposalResult } from "./safe";
import { sendAndWaitForTransaction, type GasEstimate } from "./caller";
import { type EnvironmentConfig } from "../types";
import TimelockControllerABI from "../abis/TimelockController.json";

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

export interface StoredIdentity {
  type: "eoa" | "safe" | "timelock";
  address: string;
  delay?: string;
  safeAddress?: string;
  environment?: string;
}

export type TransactionResult =
  | { type: "direct"; txHash: Hex }
  | { type: "safe-proposal"; proposal: SafeProposalResult }
  | { type: "timelock-scheduled"; txHash: Hex; timelockAddress: string; delayLabel: string }
  | { type: "safe-proposal-for-timelock"; proposal: SafeProposalResult; timelockAddress: string; delayLabel: string };

export interface IdentityRouterOptions {
  identity: StoredIdentity;
  walletClient: WalletClient;
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  to: Address;
  data: Hex;
  value?: bigint;
  environment: string;
  pendingMessage?: string;
  txDescription?: string;
  gas?: GasEstimate;
}

/**
 * Parse delay string to seconds (e.g., "24h" → 86400n)
 */
function parseDelayToSeconds(delay?: string): bigint {
  if (!delay) return 86400n; // default 24h
  const match = delay.trim().match(/^(\d+)(s|m|h|d)?$/i);
  if (!match) return 86400n;
  const n = parseInt(match[1], 10);
  const unit = (match[2] || "s").toLowerCase();
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return BigInt(n * multipliers[unit]);
}

/**
 * Route a transaction based on the active identity.
 *
 * - EOA: sign and send directly
 * - Safe: propose via Safe Transaction Service (returns proposal, not a tx hash)
 * - Timelock(EOA): encode as Timelock.schedule(), sign and send
 * - Timelock(Safe): encode as Timelock.schedule(), propose to Safe
 */
export async function sendWithIdentity(
  options: IdentityRouterOptions,
): Promise<TransactionResult> {
  const {
    identity,
    walletClient,
    publicClient,
    environmentConfig,
    to,
    data,
    value = 0n,
    environment,
    pendingMessage,
    txDescription,
    gas,
  } = options;

  switch (identity.type) {
    case "eoa": {
      // Direct transaction
      const txHash = await sendAndWaitForTransaction(
        {
          walletClient,
          publicClient,
          environmentConfig,
          to,
          data,
          value,
          pendingMessage: pendingMessage || "Sending transaction...",
          txDescription: txDescription || "Transaction",
          gas,
        },
      );
      return { type: "direct", txHash };
    }

    case "safe": {
      // Propose to Safe
      const proposal = await proposeSafeTransaction({
        walletClient,
        publicClient,
        safeAddress: identity.address as Address,
        to,
        data,
        value,
        environment,
      });
      return { type: "safe-proposal", proposal };
    }

    case "timelock": {
      const timelockAddress = identity.address as Address;
      const delaySeconds = parseDelayToSeconds(identity.delay);
      const delayLabel = identity.delay || "24h";

      // Encode the Timelock.schedule() call
      const scheduleData = encodeFunctionData({
        abi: TimelockControllerABI,
        functionName: "schedule",
        args: [
          to,             // target
          value,          // value
          data,           // calldata
          ZERO_BYTES32,   // predecessor
          ZERO_BYTES32,   // salt
          delaySeconds,   // delay
        ],
      });

      if (identity.safeAddress) {
        // Timelock(Safe): propose schedule() to the Safe
        const proposal = await proposeSafeTransaction({
          walletClient,
          publicClient,
          safeAddress: identity.safeAddress as Address,
          to: timelockAddress,
          data: scheduleData,
          environment,
        });
        return {
          type: "safe-proposal-for-timelock",
          proposal,
          timelockAddress: timelockAddress as string,
          delayLabel,
        };
      } else {
        // Timelock(EOA): send schedule() directly
        const txHash = await sendAndWaitForTransaction(
          {
            walletClient,
            publicClient,
            environmentConfig,
            to: timelockAddress,
            data: scheduleData,
            pendingMessage: pendingMessage || `Scheduling on Timelock (${delayLabel} delay)...`,
            txDescription: txDescription || "TimelockSchedule",
            gas,
          },
        );
        return { type: "timelock-scheduled", txHash, timelockAddress: timelockAddress as string, delayLabel };
      }
    }

    default:
      throw new Error(`Unknown identity type: ${(identity as any).type}`);
  }
}

/**
 * Format the result of sendWithIdentity for display
 */
export function formatTransactionResult(result: TransactionResult): string[] {
  switch (result.type) {
    case "direct":
      return [`✓ Transaction sent: ${result.txHash}`];

    case "safe-proposal":
      return [
        `✓ Proposed to Safe ${result.proposal.safeAddress}`,
        `  Safe tx hash: ${result.proposal.safeTxHash}`,
        `  Proposer: ${result.proposal.proposer}`,
        ``,
        `  Waiting for approval at:`,
        `  ${result.proposal.safeUrl}`,
      ];

    case "timelock-scheduled":
      return [
        `✓ Scheduled on Timelock ${result.timelockAddress}`,
        `  Tx: ${result.txHash}`,
        `  Delay: ${result.delayLabel}`,
        ``,
        `  After the delay elapses, execute the queued operation on the Timelock.`,
      ];

    case "safe-proposal-for-timelock":
      return [
        `✓ Proposed schedule to Safe`,
        `  Safe tx hash: ${result.proposal.safeTxHash}`,
        `  Timelock: ${result.timelockAddress} (${result.delayLabel} delay)`,
        ``,
        `  Step 1: Approve the schedule at:`,
        `  ${result.proposal.safeUrl}`,
        ``,
        `  Step 2: After Safe approval + ${result.delayLabel} delay, execute the queued operation on the Timelock.`,
      ];
  }
}
