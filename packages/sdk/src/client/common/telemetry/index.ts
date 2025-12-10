/**
 * Telemetry module for ECloud SDK and CLI
 * 
 * Provides telemetry functionality matching the Go implementation.
 * Supports both "ecloud-cli" and "ecloud-sdk" namespaces.
 */

import { TelemetryClient, Metric, AppEnvironment } from "./types";
import { NoopClient, isNoopClient } from "./noop";
import { PostHogClient, getPostHogAPIKey, getPostHogEndpoint } from "./posthog";
import * as os from "os";

export * from "./types";
export * from "./metricsContext";
export * from "./noop";
export * from "./posthog";
export * from "./wrapper";

/**
 * Options for creating a telemetry client
 */
export interface TelemetryClientOptions {
  /**
   * Whether telemetry is enabled (defaults to true if not provided)
   */
  telemetryEnabled?: boolean;
  /**
   * PostHog API key (if not provided, will check environment variables)
   */
  apiKey?: string;
  /**
   * PostHog endpoint (if not provided, will use default)
   */
  endpoint?: string;
}

/**
 * Create a telemetry client
 * 
 * @param environment - Application environment information (must include userUUID)
 * @param namespace - Namespace for telemetry events ("ecloud-cli" or "ecloud-sdk")
 * @param options - Optional telemetry client options
 * @returns TelemetryClient instance (NoopClient if telemetry is disabled or no API key)
 */
export function createTelemetryClient(
  environment: AppEnvironment,
  namespace: "ecloud-cli" | "ecloud-sdk",
  options?: TelemetryClientOptions,
): TelemetryClient {
  // Check if telemetry is disabled (defaults to enabled if not specified)
  const telemetryEnabled = options?.telemetryEnabled !== false;

  // If telemetry is disabled, return noop client
  if (!telemetryEnabled) {
    return new NoopClient();
  }

  // Get API key from options, environment variable, or return noop
  const resolvedApiKey = options?.apiKey || getPostHogAPIKey();
  if (!resolvedApiKey) {
    // No API key available, return noop client
    return new NoopClient();
  }

  // Get endpoint from options or environment variable
  const endpoint = options?.endpoint || getPostHogEndpoint();

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
 * @param userUUID - User UUID for identification (required - no I/O in SDK)
 * @param cliVersion - Optional CLI version (for CLI usage)
 * @param osOverride - Optional OS override (defaults to current platform)
 * @param archOverride - Optional architecture override (defaults to current architecture)
 * @returns AppEnvironment with user UUID, OS, and architecture
 */
export function createAppEnvironment(
  userUUID: string,
  cliVersion?: string,
  osOverride?: string,
  archOverride?: string,
): AppEnvironment {
  return {
    userUUID,
    cliVersion,
    os: osOverride || os.platform(),
    arch: archOverride || os.arch(),
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

