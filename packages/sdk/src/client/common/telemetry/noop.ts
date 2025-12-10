/**
 * No-op telemetry client implementation
 */

import { TelemetryClient, Metric } from "./types";

/**
 * NoopClient implements the TelemetryClient interface with no-op methods
 */
export class NoopClient implements TelemetryClient {
  /**
   * AddMetric implements the TelemetryClient interface
   */
  async addMetric(_metric: Metric): Promise<void> {
    // No-op
  }

  /**
   * Close implements the TelemetryClient interface
   */
  async close(): Promise<void> {
    // No-op
  }
}

/**
 * Check if a client is a NoopClient
 */
export function isNoopClient(client: TelemetryClient): boolean {
  return client instanceof NoopClient;
}


