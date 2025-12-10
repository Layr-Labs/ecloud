/**
 * Telemetry utilities for CLI commands
 * 
 * Provides helpers to wrap command execution with telemetry tracking
 */

import {
  createTelemetryClient,
  createAppEnvironment,
  createMetricsContext,
  addMetric,
  addMetricWithDimensions,
  emitMetrics,
  type TelemetryClient,
  getBuildType,
} from "@layr-labs/ecloud-sdk";
import { Command } from "@oclif/core";
import { getDefaultEnvironment } from "./utils/globalConfig";

/**
 * Create a telemetry client for CLI usage
 */
export function createCLITelemetryClient(): TelemetryClient {
  const environment = createAppEnvironment();
  return createTelemetryClient(environment, "ecloud-cli");
}

/**
 * Wrap a command execution with telemetry
 * 
 * @param command - The CLI command instance
 * @param action - The command action to execute
 * @returns The result of the action
 */
export async function withTelemetry<T>(
  command: Command,
  action: () => Promise<T>,
): Promise<T> {
  const client = createCLITelemetryClient();
  const metrics = createMetricsContext();

  // Set source to identify CLI usage
  metrics.properties["source"] = "ecloud-cli";
  
  // Set command name in properties
  metrics.properties["command"] = command.id || command.constructor.name;

  // Set environment in properties
  const environment = getDefaultEnvironment() || "sepolia";
  metrics.properties["environment"] = environment;

  // Set buildType in properties
  const buildType = getBuildType() || "prod";
  metrics.properties["build_type"] = buildType;

  // Set CLI version if available
  const cliVersion = command.config.version;
  if (cliVersion) {
    metrics.properties["cli_version"] = cliVersion;
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

