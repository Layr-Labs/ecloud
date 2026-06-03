import { Flags } from "@oclif/core";
import { getBuildType, type GasEstimate } from "@layr-labs/ecloud-sdk";
import { getEnvironmentInteractive, getPrivateKeyInteractive } from "./utils/prompts";
import { getDefaultEnvironment } from "./utils/globalConfig";
import { type Address, formatEther, parseGwei, type PublicClient } from "viem";

export type CommonFlags = {
  verbose: boolean;
  environment: string;
  "private-key"?: string;
  "rpc-url"?: string;
  "max-fee-per-gas"?: string;
  "max-priority-fee"?: string;
  nonce?: string;
  "non-interactive"?: boolean;
};

export const commonFlags = {
  environment: Flags.string({
    required: false,
    description: "Deployment environment to use",
    env: "ECLOUD_ENV",
    default: async () =>
      getDefaultEnvironment() || (getBuildType() === "dev" ? "sepolia-dev" : "mainnet-alpha"),
  }),
  "private-key": Flags.string({
    required: false,
    description: "Private key for signing transactions",
    env: "ECLOUD_PRIVATE_KEY",
  }),
  "rpc-url": Flags.string({
    required: false,
    description: "RPC URL to connect to blockchain",
    env: "ECLOUD_RPC_URL",
  }),
  verbose: Flags.boolean({
    required: false,
    description: "Enable verbose logging (default: false)",
    default: false,
  }),
  "max-fee-per-gas": Flags.string({
    required: false,
    description: "Override max fee per gas in gwei (e.g., 50)",
    env: "ECLOUD_MAX_FEE_PER_GAS",
  }),
  "max-priority-fee": Flags.string({
    required: false,
    description: "Override max priority fee per gas in gwei (e.g., 5)",
    env: "ECLOUD_MAX_PRIORITY_FEE",
  }),
  nonce: Flags.string({
    required: false,
    description: 'Override transaction nonce (integer or "latest" to replace a stuck transaction)',
  }),
  "non-interactive": Flags.boolean({
    required: false,
    description:
      "Assume non-interactive mode: default safe prompts and error all-at-once on missing required inputs",
    env: "ECLOUD_NON_INTERACTIVE",
    default: false,
  }),
};

/**
 * Apply user-provided gas and nonce overrides to an estimated GasEstimate.
 * If the user passed --max-fee-per-gas or --max-priority-fee, those values
 * replace the estimated ones and maxCostWei/maxCostEth are recalculated.
 * If --nonce is provided as a number, it sets the transaction nonce explicitly.
 * If --nonce is "latest", the first unconfirmed nonce is fetched (to replace a stuck tx).
 */
export async function applyTxOverrides(
  estimate: GasEstimate,
  flags: CommonFlags,
  opts?: { publicClient: PublicClient; address: Address },
): Promise<GasEstimate> {
  const maxFeeStr = flags["max-fee-per-gas"];
  const priorityFeeStr = flags["max-priority-fee"];
  const nonceStr = flags.nonce;

  if (!maxFeeStr && !priorityFeeStr && nonceStr == null) return estimate;

  let { gasLimit, maxFeePerGas, maxPriorityFeePerGas } = estimate;

  if (maxFeeStr) {
    maxFeePerGas = parseGwei(maxFeeStr);
  }
  if (priorityFeeStr) {
    maxPriorityFeePerGas = parseGwei(priorityFeeStr);
  }

  // Ensure maxFeePerGas >= maxPriorityFeePerGas
  if (maxFeePerGas < maxPriorityFeePerGas) {
    maxFeePerGas = maxPriorityFeePerGas;
  }

  const maxCostWei = gasLimit * maxFeePerGas;
  const eth = Number(formatEther(maxCostWei));
  const maxCostEth = eth.toFixed(6).replace(/\.?0+$/, "") || "<0.000001";

  let nonce: number | undefined;
  if (nonceStr != null) {
    if (nonceStr === "latest") {
      if (!opts?.publicClient || !opts?.address) {
        throw new Error("--nonce latest requires a public client and address");
      }
      nonce = await opts.publicClient.getTransactionCount({
        address: opts.address,
        blockTag: "latest",
      });
    } else {
      const parsed = Number(nonceStr);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`Invalid nonce: "${nonceStr}". Must be a non-negative integer or "latest".`);
      }
      nonce = parsed;
    }
  }

  return { gasLimit, maxFeePerGas, maxPriorityFeePerGas, maxCostWei, maxCostEth, nonce };
}

// Prompt for missing required values interactively
export async function validateCommonFlags(
  flags: CommonFlags,
  options?: { requirePrivateKey?: boolean },
) {
  // Validate environment (in case user passed an invalid one)
  flags["environment"] = await getEnvironmentInteractive(flags["environment"]);
  if (options?.requirePrivateKey !== false) {
    flags["private-key"] = await getPrivateKeyInteractive(flags["private-key"]);
  }
  return flags;
}
