import { createAppModule, createBillingModule, getPrivateKeyInteractive, getEnvironmentConfig } from "@ecloud/sdk";
import { CommonFlags, validateCommonFlags } from "./flags";
import { Hex } from "viem";

export async function createAppClient(flags: CommonFlags) {
  flags = await validateCommonFlags(flags);

  const environment = flags.environment!;
  const environmentConfig = getEnvironmentConfig(environment);
  const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;

  return createAppModule({
    verbose: flags.verbose,
    privateKey: flags["private-key"] as `0x${string}`,
    rpcUrl,
    environment,
  });
}

export async function createBillingClient(flags: { "private-key"?: string; verbose?: boolean }) {
  const privateKey = await getPrivateKeyInteractive(flags["private-key"]);

  return createBillingModule({
    verbose: flags.verbose ?? false,
    privateKey: privateKey as Hex,
  });
}
