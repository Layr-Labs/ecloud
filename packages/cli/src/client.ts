import { createECloudClient } from "@ecloud/sdk";

export function loadClient(flags: {
  privateKey: string;
  environment: string;
  rpcUrl?: string;
  apiBaseUrl?: string;
}) {
  return createECloudClient({
    privateKey: flags.privateKey as `0x${string}`,
    environment: flags.environment,
    rpcUrl: flags.rpcUrl,
    apiBaseUrl: flags.apiBaseUrl,
  });
}
