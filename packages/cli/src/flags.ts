import { Flags } from "@oclif/core";
import { getBuildType } from "@layr-labs/ecloud-sdk";
import { getEnvironmentInteractive, getPrivateKeyInteractive } from "./utils/prompts";
import { getDefaultEnvironment } from "./utils/globalConfig";

export type CommonFlags = {
  verbose: boolean;
  environment: string;
  "private-key"?: string;
  "rpc-url"?: string;
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
};

// Prompt for missing required values interactively
export async function validateCommonFlags(flags: CommonFlags, options?: { requirePrivateKey?: boolean }) {
  // Validate environment (in case user passed an invalid one)
  flags["environment"] = await getEnvironmentInteractive(flags["environment"]);
  if (options?.requirePrivateKey !== false) {
    flags["private-key"] = await getPrivateKeyInteractive(flags["private-key"]);
  }
  return flags;
}
