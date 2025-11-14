import { createECloudClient } from "@ecloud/sdk";

export function loadClient(flags: {
  verbose: boolean;
  environment: string;
  "private-key": string;
  "rpc-url"?: string;
}) {
  return createECloudClient({
    verbose: flags.verbose,
    environment: flags.environment,
    privateKey: flags["private-key"] as `0x${string}`,
    rpcUrl: flags["rpc-url"],
  });
}
