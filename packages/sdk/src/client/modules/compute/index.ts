/**
 * Main Compute namespace entry point
 */

import { createAppModule, type AppModule, type AppModuleConfig } from "./app";

export interface ComputeModule {
  app: AppModule;
}

export interface ComputeModuleConfig {
  verbose?: boolean;
  privateKey: `0x${string}`;
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
