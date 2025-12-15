/**
 * Telemetry wrapper utilities for SDK functions
 *
 * Provides helpers to wrap SDK function execution with telemetry tracking
 */

import {
  createTelemetryClient,
  createAppEnvironment,
  createMetricsContext,
  addMetric,
  addMetricWithDimensions,
  emitMetrics,
} from "./index";
import { randomUUID } from "crypto";

/**
 * Generate a random UUID for telemetry identification
 * Used when userUUID is not provided (SDK usage outside CLI)
 */
function generateRandomUUID(): string {
  return randomUUID();
}

/**
 * Options for telemetry wrapper
 */
export interface TelemetryWrapperOptions {
  /**
   * Function name for telemetry (e.g., "deploy", "upgrade", "createApp")
   */
  functionName: string;
  /**
   * Skip telemetry if true (used when called from CLI)
   */
  skipTelemetry?: boolean;
  /**
   * Additional properties to include in telemetry
   */
  properties?: Record<string, string>;
  /**
   * User UUID for identification (required if skipTelemetry is false)
   * If not provided and telemetry is enabled, will generate a random UUID for this session
   */
  userUUID?: string;
  /**
   * Whether telemetry is enabled (defaults to true if not provided)
   */
  telemetryEnabled?: boolean;
  /**
   * PostHog API key (optional, will check environment variables if not provided)
   */
  apiKey?: string;
  /**
   * PostHog endpoint (optional, will use default if not provided)
   */
  endpoint?: string;
}

/**
 * Wrap a function execution with telemetry
 *
 * @param options - Telemetry wrapper options
 * @param action - The function to execute
 * @returns The result of the action
 */
export async function withSDKTelemetry<T>(
  options: TelemetryWrapperOptions,
  action: () => Promise<T>,
): Promise<T> {
  // Skip telemetry if requested (e.g., when called from CLI)
  if (options.skipTelemetry) {
    return action();
  }

  // Generate a random UUID if not provided (for SDK usage outside CLI)
  // This ensures each SDK session has a unique identifier
  const userUUID = options.userUUID || generateRandomUUID();

  const environment = createAppEnvironment(userUUID);
  const client = createTelemetryClient(environment, "ecloud-sdk", {
    telemetryEnabled: options.telemetryEnabled,
    apiKey: options.apiKey,
    endpoint: options.endpoint,
  });
  const metrics = createMetricsContext();

  // Set source to identify SDK usage
  metrics.properties["source"] = "ecloud-sdk";

  // Set function name in properties
  metrics.properties["function"] = options.functionName;

  // Add any additional properties
  if (options.properties) {
    Object.assign(metrics.properties, options.properties);
  }

  // Add initial count metric
  addMetric(metrics, "Count", 1);

  let actionError: Error | undefined;
  let result: T;

  try {
    result = await action();
    return result;
  } catch (err) {
    actionError = err instanceof Error ? err : new Error(String(err));
    throw err;
  } finally {
    // Add result metric
    const resultValue = actionError ? "Failure" : "Success";
    const dimensions: Record<string, string> = {};
    if (actionError) {
      dimensions["error"] = actionError.message;
    }
    addMetricWithDimensions(metrics, resultValue, 1, dimensions);

    // Add duration metric
    const duration = Date.now() - metrics.startTime.getTime();
    addMetric(metrics, "DurationMilliseconds", duration);

    // Emit all metrics
    try {
      await emitMetrics(client, metrics);
      await client.close();
    } catch {
      // Silently ignore telemetry errors
    }
  }
}
