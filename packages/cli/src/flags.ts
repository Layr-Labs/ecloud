import { Flags } from "@oclif/core";

export const commonFlags = {
  environment: Flags.string({
    required: true,
    description: "Deployment environment to use",
    options: ["sepolia", "mainnet-alpha"],
    env: "ECLOUD_ENV",
  }),
  "private-key": Flags.string({
    required: true,
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
