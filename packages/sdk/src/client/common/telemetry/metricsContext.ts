/**
 * MetricsContext management
 */

import { Metric, MetricsContext } from "./types";

/**
 * Create a new metrics context
 */
export function createMetricsContext(): MetricsContext {
  return {
    startTime: new Date(),
    metrics: [],
    properties: {},
  };
}

/**
 * Add a metric to the context without dimensions
 */
export function addMetric(
  context: MetricsContext,
  name: string,
  value: number,
): void {
  addMetricWithDimensions(context, name, value, {});
}

/**
 * Add a metric to the context with dimensions
 */
export function addMetricWithDimensions(
  context: MetricsContext,
  name: string,
  value: number,
  dimensions: Record<string, string>,
): void {
  context.metrics.push({
    name,
    value,
    dimensions,
  });
}


