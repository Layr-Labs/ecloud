import { Flags } from "@oclif/core";
import { getBuildType, type GasEstimate } from "@layr-labs/ecloud-sdk";
import { getEnvironmentInteractive, getPrivateKeyInteractive } from "./utils/prompts";
import { getDefaultEnvironment } from "./utils/globalConfig";
import { parseGwei } from "viem";

export type CommonFlags = {
  verbose: boolean;
  environment: string;
  "private-key"?: string;
  "rpc-url"?: string;
  "max-fee-per-gas"?: string;
  "max-priority-fee"?: string;
};

export const commonFlags = {
  environment: Flags.string({
    required: false,
    description: "Deployment environment to use",
    env: "ECLOUD_ENV",
    default: async () =>
      getDefaultEnvironment() || (getBuildType() === "dev" ? "sepolia-dev" : "sepolia"),
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
};

/**
 * Apply user-provided gas overrides to an estimated GasEstimate.
 * If the user passed --max-fee-per-gas or --max-priority-fee, those values
 * replace the estimated ones and maxCostWei/maxCostEth are recalculated.
 */
export function applyGasOverrides(estimate: GasEstimate, flags: CommonFlags): GasEstimate {
  const maxFeeStr = flags["max-fee-per-gas"];
  const priorityFeeStr = flags["max-priority-fee"];

  if (!maxFeeStr && !priorityFeeStr) return estimate;

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
  const eth = Number(maxCostWei) / 1e18;
  const maxCostEth = eth.toFixed(6).replace(/\.?0+$/, "") || "<0.000001";

  return { gasLimit, maxFeePerGas, maxPriorityFeePerGas, maxCostWei, maxCostEth };
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
