/**
 * Main Compute namespace entry point
 */

import { Hex } from "viem";
import { createAppModule, type AppModule } from "./app";

export interface ComputeModule {
  app: AppModule;
}

export interface ComputeModuleConfig {
  verbose?: boolean;
  privateKey: Hex;
  rpcUrl: string;
  environment: string;
  clientId?: string;
  skipTelemetry?: boolean;
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
