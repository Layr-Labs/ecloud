import { Flags } from "@oclif/core";

export const commonFlags = {
  privateKey: Flags.string({ required: true, env: "ECLOUD_PRIVATE_KEY" }),
  environment: Flags.string({
    required: true,
    options: ["sepolia", "mainnet-alpha"],
    env: "ECLOUD_ENV",
  }),
  rpcUrl: Flags.string({ required: false, env: "ECLOUD_RPC_URL" }),
  apiBaseUrl: Flags.string({ required: false, env: "ECLOUD_API_BASE_URL" }),
};
