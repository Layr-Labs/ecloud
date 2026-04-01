import {
  createComputeModule,
  createBillingModule,
  createBuildModule,
  getEnvironmentConfig,
  requirePrivateKey,
} from "@layr-labs/ecloud-sdk";
import { CommonFlags, validateCommonFlags } from "./flags";
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

export async function createBillingClient(flags: CommonFlags) {
  flags = await validateCommonFlags(flags);

  const environment = flags.environment;
  const environmentConfig = getEnvironmentConfig(environment);
  const rpcUrl = flags["rpc-url"] || environmentConfig.billingRPCURL || environmentConfig.defaultRPCURL;
  const { key: privateKey, source } = await requirePrivateKey({
    privateKey: flags["private-key"],
  });

  if (flags.verbose) {
    console.log(`Using private key from: ${source}`);
  }

  const { walletClient, publicClient } = createViemClients({
    privateKey: privateKey as Hex,
    rpcUrl,
    environment,
  });

  return createBillingModule({
    verbose: flags.verbose,
    walletClient,
    publicClient,
    environment,
    skipTelemetry: true,
  });
}

export async function createBuildClient(flags: CommonFlags) {
  // Environment is useful for choosing the correct API base URL; private key is only needed for
  // authenticated operations (submit/logs).
  flags = await validateCommonFlags(flags, { requirePrivateKey: false });

  // Get environment config for RPC URL
  const environment = flags.environment;
  const environmentConfig = getEnvironmentConfig(environment);
  const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;

  // Only create walletClient if we have a private key - createViemClients throws if privateKey is undefined
  let walletClient;
  if (flags["private-key"]) {
    walletClient = createViemClients({
      privateKey: flags["private-key"] as Hex,
      rpcUrl,
      environment,
    }).walletClient;
  }

  return createBuildModule({
    verbose: flags.verbose,
    walletClient,
    environment,
    clientId: getClientId(),
    skipTelemetry: true, // CLI already has telemetry, skip SDK telemetry
  });
}
