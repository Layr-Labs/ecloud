import { createECloudClient } from "@ecloud/sdk";
import { CommonFlags, validateCommonFlags } from "./flags";

export async function loadClient(flags: CommonFlags) {
  flags = await validateCommonFlags(flags);
  
  return createECloudClient({
    verbose: flags.verbose,
    environment: flags.environment!,
    privateKey: flags["private-key"] as `0x${string}`,
    rpcUrl: flags["rpc-url"],
  });
}
