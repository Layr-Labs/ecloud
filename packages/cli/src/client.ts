import {
  createComputeModule,
  createBillingModule,
  getEnvironmentConfig,
  requirePrivateKey,
  getPrivateKeyWithSource,
} from "@layr-labs/ecloud-sdk";
import { CommonFlags, validateCommonFlags } from "./flags";
import { getPrivateKeyInteractive } from "./utils/prompts";
import { getClientId } from "./utils/version";
import { Hex } from "viem";

export async function createComputeClient(flags: CommonFlags) {
  flags = await validateCommonFlags(flags);

  const environment = flags.environment;
  const environmentConfig = getEnvironmentConfig(environment);
  const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;
  const { key: privateKey, source } = await requirePrivateKey({
    privateKey: flags["private-key"],
  });

  if (flags.verbose) {
    console.log(`Using private key from: ${source}`);
  }

  return createComputeModule({
    verbose: flags.verbose,
    privateKey,
    rpcUrl,
    environment,
    clientId: getClientId(),
    skipTelemetry: true, // CLI already has telemetry, skip SDK telemetry
  });
}

export async function createBillingClient(flags: { "private-key"?: string; verbose?: boolean }) {
  const result = await getPrivateKeyWithSource({
    privateKey: flags["private-key"],
  });
  const privateKey = await getPrivateKeyInteractive(result?.key);

  return createBillingModule({
    verbose: flags.verbose ?? false,
    privateKey: privateKey as Hex,
    skipTelemetry: true, // CLI already has telemetry, skip SDK telemetry
  });
}
