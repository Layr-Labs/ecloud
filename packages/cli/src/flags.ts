import { getEnvironmentInteractive, getPrivateKeyInteractive, getRPCUrlInteractive } from "@ecloud/sdk";
import { Flags } from "@oclif/core";

export type CommonFlags = {
  verbose: boolean;
  environment?: string;
  "private-key"?: string;
  "rpc-url"?: string;
};

export const commonFlags = {
  environment: Flags.string({
    required: false,
    description: "Deployment environment to use",
    options: ["sepolia", "sepolia-dev", "mainnet-alpha"],
    env: "ECLOUD_ENV",
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

// Validate or prompt for required common flags
export async function validateCommonFlags(flags: CommonFlags) {
  flags["environment"] = await getEnvironmentInteractive(flags["environment"]);
  flags["private-key"] = await getPrivateKeyInteractive(flags["private-key"]);

  return flags;
};
