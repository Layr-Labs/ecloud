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
  type TelemetryClient,
} from "./index";

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

  const environment = createAppEnvironment();
  const client = createTelemetryClient(environment, "ecloud-sdk");
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
    } catch (err) {
      // Silently ignore telemetry errors
    }
  }
}

