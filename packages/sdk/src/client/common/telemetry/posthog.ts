/**
 * PostHog telemetry client implementation
 * 
 * Uses PostHog HTTP API directly
 */

import axios from "axios";
import { TelemetryClient, Metric, AppEnvironment } from "./types";

/**
 * PostHogClient implements the TelemetryClient interface using PostHog HTTP API
 */
export class PostHogClient implements TelemetryClient {
  private readonly namespace: string;
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly appEnvironment: AppEnvironment;

  constructor(
    environment: AppEnvironment,
    namespace: string,
    apiKey: string,
    endpoint?: string,
  ) {
    this.namespace = namespace;
    this.apiKey = apiKey;
    this.endpoint = endpoint || "https://us.i.posthog.com";
    this.appEnvironment = environment;
  }

  /**
   * AddMetric implements the TelemetryClient interface
   */
  async addMetric(metric: Metric): Promise<void> {
    // Create properties map starting with base properties
    const props: Record<string, any> = {
      name: metric.name,
      value: metric.value,
    };

    // Add metric dimensions
    for (const [k, v] of Object.entries(metric.dimensions)) {
      props[k] = v;
    }

    // Never throw errors from telemetry operations
    try {
      // Send event to PostHog capture endpoint
      await axios.post(
        `${this.endpoint}/capture/`,
        {
          api_key: this.apiKey,
          event: this.namespace,
          distinct_id: this.appEnvironment.userUUID,
          properties: props,
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 5000, // 5 second timeout
        },
      );
    } catch (err) {
      // Silently ignore telemetry errors
    }
  }

  /**
   * Close implements the TelemetryClient interface
   */
  async close(): Promise<void> {
    // PostHog HTTP API doesn't require explicit close
    // This is a no-op to match the interface
  }
}

/**
 * Embedded PostHog API key (can be exposed in TypeScript)
 * This can be set at build time or overridden via environment variable
 */
// @ts-ignore - POSTHOG_API_KEY_BUILD_TIME is injected at build time by tsup
declare const POSTHOG_API_KEY_BUILD_TIME: string | undefined;

/**
 * Get PostHog API key from environment variable or build-time constant
 */
export function getPostHogAPIKey(): string | undefined {
  // Priority order:
  // 1. Environment variable
  // 2. Build-time constant (set at build time)
  // Check environment variable first
  if (process.env.ECLOUD_POSTHOG_KEY) {
    return process.env.ECLOUD_POSTHOG_KEY;
  }

  // Return build-time constant if available
  // @ts-ignore - POSTHOG_API_KEY_BUILD_TIME is injected at build time
  return typeof POSTHOG_API_KEY_BUILD_TIME !== "undefined"
    ? POSTHOG_API_KEY_BUILD_TIME
    : undefined;
}

/**
 * Get PostHog endpoint from environment variable or default
 */
export function getPostHogEndpoint(): string {
  return (
    process.env.ECLOUD_POSTHOG_ENDPOINT ||
    "https://us.i.posthog.com"
  );
}

