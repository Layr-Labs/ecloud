/**
 * Telemetry types
 */

/**
 * Metric represents a single metric with its value and dimensions
 */
export interface Metric {
  value: number;
  name: string;
  dimensions: Record<string, string>;
}

/**
 * MetricsContext holds all metrics collected during command execution
 */
export interface MetricsContext {
  startTime: Date;
  metrics: Metric[];
  properties: Record<string, string>;
}

/**
 * AppEnvironment contains information about the application environment
 */
export interface AppEnvironment {
  userUUID: string;
  cliVersion?: string;
  os?: string;
  arch?: string;
}

/**
 * TelemetryClient defines the interface for telemetry operations
 */
export interface TelemetryClient {
  /**
   * AddMetric emits a single metric
   */
  addMetric(metric: Metric): Promise<void>;
  /**
   * Close cleans up any resources
   */
  close(): Promise<void>;
}
