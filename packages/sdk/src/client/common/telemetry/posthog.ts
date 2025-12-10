/**
 * PostHog telemetry client implementation
 *
 * Uses the official posthog-node library
 */

import { PostHog } from "posthog-node";
import { TelemetryClient, Metric, AppEnvironment } from "./types";

/**
 * PostHogClient implements the TelemetryClient interface using posthog-node
 */
export class PostHogClient implements TelemetryClient {
  private readonly client: PostHog;
  private readonly namespace: string;
  private readonly appEnvironment: AppEnvironment;

  constructor(environment: AppEnvironment, namespace: string, apiKey: string, endpoint?: string) {
    this.namespace = namespace;
    this.appEnvironment = environment;

    // Initialize PostHog client
    // posthog-node expects the full URL for the host option
    const host = endpoint || "https://us.i.posthog.com";

    this.client = new PostHog(apiKey, {
      host: host,
      flushAt: 1, // Flush immediately for CLI/SDK usage
      flushInterval: 0, // Disable interval flushing
    });

    // Identify the user with their UUID
    this.client.identify({
      distinctId: environment.userUUID,
      properties: {
        os: environment.os,
        arch: environment.arch,
        ...(environment.cliVersion ? { cliVersion: environment.cliVersion } : {}),
      },
    });
  }

  /**
   * AddMetric implements the TelemetryClient interface
   */
  async addMetric(metric: Metric): Promise<void> {
    // Never throw errors from telemetry operations
    try {
      // Create properties map starting with base properties
      const props: Record<string, any> = {
        name: metric.name,
        value: metric.value,
      };

      // Add metric dimensions
      for (const [k, v] of Object.entries(metric.dimensions)) {
        props[k] = v;
      }

      // Capture event using the namespace as the event name
      // With flushAt: 1, events are automatically flushed after each capture
      this.client.capture({
        distinctId: this.appEnvironment.userUUID,
        event: this.namespace,
        properties: props,
      });
    } catch {
      // Silently ignore telemetry errors
    }
  }

  /**
   * Close implements the TelemetryClient interface
   */
  async close(): Promise<void> {
    try {
      // Shutdown PostHog client and flush any pending events
      // shutdown() is synchronous but internally handles async cleanup
      this.client.shutdown();
    } catch {
      // Silently ignore errors during shutdown
    }
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
  return typeof POSTHOG_API_KEY_BUILD_TIME !== "undefined" ? POSTHOG_API_KEY_BUILD_TIME : undefined;
}

/**
 * Get PostHog endpoint from environment variable or default
 */
export function getPostHogEndpoint(): string {
  return process.env.ECLOUD_POSTHOG_ENDPOINT || "https://us.i.posthog.com";
}
