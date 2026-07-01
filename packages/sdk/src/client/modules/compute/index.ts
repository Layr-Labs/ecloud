/**
 * Main Compute namespace entry point
 */

import { type WalletClient, type PublicClient } from "viem";
import { type Logger } from "../../common/types";
import { createAppModule, type AppModule } from "./app";

export interface ComputeModule {
  app: AppModule;
}

export interface ComputeModuleConfig {
  verbose?: boolean;
  walletClient: WalletClient;
  publicClient: PublicClient;
  environment: string;
  clientId?: string;
  skipTelemetry?: boolean;
  /**
   * Optional logger override. When provided, the module routes all progress
   * output through it instead of the default stdout/stderr logger. Callers
   * emitting machine-readable output (e.g. `--json`) pass a logger that writes
   * to stderr so stdout stays pure.
   */
  logger?: Logger;
}

export function createComputeModule(config: ComputeModuleConfig): ComputeModule {
  return {
    app: createAppModule(config),
  };
}

// Re-export app module for standalone use
export { createAppModule, type AppModule, type AppModuleConfig } from "./app";

// Re-export app module utilities
export { encodeStartAppData, encodeStopAppData, encodeTerminateAppData } from "./app";
