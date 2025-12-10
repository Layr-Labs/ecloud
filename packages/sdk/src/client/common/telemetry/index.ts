/**
 * Telemetry module for ECloud SDK and CLI
 * 
 * Provides telemetry functionality matching the Go implementation.
 * Supports both "ecloud-cli" and "ecloud-sdk" namespaces.
 */

import { TelemetryClient, Metric, AppEnvironment } from "./types";
import { NoopClient, isNoopClient } from "./noop";
import { PostHogClient, getPostHogAPIKey, getPostHogEndpoint } from "./posthog";
import {
  getGlobalTelemetryPreference,
  getOrCreateUserUUID,
  loadGlobalConfig,
} from "../config/globalConfig";
import * as os from "os";

export * from "./types";
export * from "./metricsContext";
export * from "./noop";
export * from "./posthog";
export * from "./wrapper";

/**
 * Create a telemetry client
 * 
 * @param environment - Application environment information
 * @param namespace - Namespace for telemetry events ("ecloud-cli" or "ecloud-sdk")
 * @param apiKey - Optional PostHog API key (if not provided, will check environment variables)
 * @returns TelemetryClient instance (NoopClient if telemetry is disabled or no API key)
 */
export function createTelemetryClient(
  environment: AppEnvironment,
  namespace: "ecloud-cli" | "ecloud-sdk",
  apiKey?: string,
): TelemetryClient {
  // Get global telemetry preference
  const telemetryEnabled = getGlobalTelemetryPreference();

  // If telemetry is disabled or not set, return noop client
  if (telemetryEnabled === false) {
    return new NoopClient();
  }

  // Get API key from parameter, environment variable, or return noop
  const resolvedApiKey = apiKey || getPostHogAPIKey();
  if (!resolvedApiKey) {
    // No API key available, return noop client
    return new NoopClient();
  }

  // Get endpoint
  const endpoint = getPostHogEndpoint();

  try {
    return new PostHogClient(environment, namespace, resolvedApiKey, endpoint);
  } catch (err) {
    // If initialization fails, return noop client
    return new NoopClient();
  }
}

/**
 * Create an AppEnvironment from current system information
 * 
 * @param cliVersion - Optional CLI version (for CLI usage)
 * @returns AppEnvironment with user UUID, OS, and architecture
 */
export function createAppEnvironment(cliVersion?: string): AppEnvironment {
  const userUUID = getOrCreateUserUUID();
  
  // Ensure UserUUID is saved for consistent tracking across sessions
  const config = loadGlobalConfig();
  if (!config.user_uuid) {
    // This will be saved by getOrCreateUserUUID, but we can also save it explicitly
    // The function already handles saving, so this is just for safety
  }

  return {
    userUUID,
    cliVersion,
    os: os.platform(),
    arch: os.arch(),
  };
}

/**
 * Emit metrics from a metrics context
 * 
 * @param client - Telemetry client to use
 * @param context - Metrics context containing metrics to emit
 * @returns Promise that resolves when all metrics are emitted
 */
export async function emitMetrics(
  client: TelemetryClient,
  context: {
    metrics: Metric[];
    properties: Record<string, string>;
  },
): Promise<void> {
  if (isNoopClient(client)) {
    return;
  }

  // Emit each metric with properties merged into dimensions
  for (const metric of context.metrics) {
    const dimensions = {
      ...metric.dimensions,
      ...context.properties,
    };

    const metricWithProperties: Metric = {
      ...metric,
      dimensions,
    };

    try {
      await client.addMetric(metricWithProperties);
    } catch (err) {
      // Silently ignore telemetry errors
    }
  }
}

