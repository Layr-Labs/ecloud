/**
 * Billing utility functions
 */

import type { SubscriptionStatus } from "../types";

/**
 * Check if subscription status allows deploying apps
 */
export function isSubscriptionActive(status: SubscriptionStatus): boolean {
  return status === "active" || status === "trialing";
}
