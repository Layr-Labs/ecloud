import {
  createComputeModule,
  createBillingModule,
  createBuildModule,
  getEnvironmentConfig,
  requirePrivateKey,
  getPrivateKeyWithSource,
} from "@layr-labs/ecloud-sdk";
import { CommonFlags, validateCommonFlags } from "./flags";
import { getPrivateKeyInteractive } from "./utils/prompts";
import { getClientId } from "./utils/version";
import { createViemClients } from "./utils/viemClients";
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

  // Create viem clients from private key
  const { walletClient, publicClient } = createViemClients({
    privateKey: privateKey as Hex,
    rpcUrl,
    environment,
  });

  return createComputeModule({
    verbose: flags.verbose,
    walletClient,
    publicClient,
    environment,
    clientId: getClientId(),
    skipTelemetry: true, // CLI already has telemetry, skip SDK telemetry
  });
}

export async function createBillingClient(flags: {
  "private-key"?: string;
  verbose?: boolean;
  environment?: string;
  "rpc-url"?: string;
}) {
  const result = await getPrivateKeyWithSource({
    privateKey: flags["private-key"],
  });
  const privateKey = await getPrivateKeyInteractive(result?.key);

  // Get environment config for RPC URL
  const environment = flags.environment || "mainnet";
  const environmentConfig = getEnvironmentConfig(environment);
  const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;

  // Create wallet client from private key
  const { walletClient } = createViemClients({
    privateKey: privateKey as Hex,
    rpcUrl,
    environment,
  });

  return createBillingModule({
    verbose: flags.verbose ?? false,
    walletClient,
    skipTelemetry: true, // CLI already has telemetry, skip SDK telemetry
  });
}

export async function createBuildClient(flags: CommonFlags) {
  // Environment is useful for choosing the correct API base URL; private key is only needed for
  // authenticated operations (submit/logs).
  flags = await validateCommonFlags(flags, { requirePrivateKey: false });

  // Get environment config for RPC URL
  const environment = flags.environment || "mainnet";
  const environmentConfig = getEnvironmentConfig(environment);
  const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;

  const { walletClient } = createViemClients({
    privateKey: flags["private-key"] as Hex,
    rpcUrl,
    environment,
  });

  return createBuildModule({
    verbose: flags.verbose,
    walletClient: flags["private-key"] ? walletClient : undefined,
    environment,
    clientId: getClientId(),
    skipTelemetry: true, // CLI already has telemetry, skip SDK telemetry
  });
}
