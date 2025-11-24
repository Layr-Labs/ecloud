/**
 * Main Billing namespace entry point
 */

import { BillingApiClient } from "../../common/utils/billingapi";
import { getBillingEnvironmentConfig } from "../../common/config/environment";
import { getLogger, isSubscriptionActive, addHexPrefix } from "../../common/utils";

import type { Hex } from "viem";
import type {
  ProductID,
  SubscriptionOpts,
  SubscribeResponse,
  CancelResponse,
  ProductSubscriptionResponse,
} from "../../common/types";

export interface BillingModule {
  subscribe: (opts?: SubscriptionOpts) => Promise<SubscribeResponse>;
  getStatus: (
    opts?: SubscriptionOpts,
  ) => Promise<ProductSubscriptionResponse>;
  cancel: (opts?: SubscriptionOpts) => Promise<CancelResponse>;
}

export interface BillingModuleConfig {
    verbose?: boolean;
    privateKey: Hex;
}

export function createBillingModule(config: BillingModuleConfig): BillingModule {
  const { verbose = false } = config;
  const privateKey = addHexPrefix(config.privateKey);

  const logger = getLogger(verbose);

  // Get billing environment configuration
  // TODO: The billing environment should be driven by the build environment, but this hasn't been
  // implemented else where yet, so we'll just use "dev" for now.
  const billingEnvConfig = getBillingEnvironmentConfig("dev");

  // Create billing API client
  const billingApi = new BillingApiClient(billingEnvConfig, privateKey);

  return {
    async subscribe(opts) {
      const productId: ProductID = opts?.productId || "compute";

      // Check existing subscription status first
      logger.debug(`Checking existing subscription for ${productId}...`);
      const currentStatus = await billingApi.getSubscription(productId);

      // If already active or trialing, don't create new checkout
      if (isSubscriptionActive(currentStatus.subscriptionStatus)) {
        logger.debug(`Subscription already active: ${currentStatus.subscriptionStatus}`);
        return {
          type: "already_active" as const,
          status: currentStatus.subscriptionStatus,
        };
      }

      // If subscription has payment issues, return portal URL instead
      if (currentStatus.subscriptionStatus === "past_due" || currentStatus.subscriptionStatus === "unpaid") {
        logger.debug(`Subscription has payment issue: ${currentStatus.subscriptionStatus}`);
        return {
          type: "payment_issue" as const,
          status: currentStatus.subscriptionStatus,
          portalUrl: currentStatus.portalUrl,
        };
      }

      // Create new checkout session
      logger.debug(`Creating subscription for ${productId}...`);
      const result = await billingApi.createSubscription(productId);

      logger.debug(`Checkout URL: ${result.checkoutUrl}`);
      return {
        type: "checkout_created" as const,
        checkoutUrl: result.checkoutUrl,
      };
    },

    async getStatus(opts) {
      const productId: ProductID = opts?.productId || "compute";
      logger.debug(`Fetching subscription status for ${productId}...`);

      const result = await billingApi.getSubscription(productId);

      logger.debug(
        `Subscription status: ${result.subscriptionStatus}`,
      );
      return result;
    },

    async cancel(opts) {
      const productId: ProductID = opts?.productId || "compute";

      // Check existing subscription status first
      logger.debug(`Checking subscription status for ${productId}...`);
      const currentStatus = await billingApi.getSubscription(productId);

      // If no active subscription, don't attempt to cancel
      if (!isSubscriptionActive(currentStatus.subscriptionStatus)) {
        logger.debug(
          `No active subscription to cancel: ${currentStatus.subscriptionStatus}`,
        );
        return {
          type: "no_active_subscription" as const,
          status: currentStatus.subscriptionStatus,
        };
      }

      // Cancel the subscription
      logger.debug(`Canceling subscription for ${productId}...`);
      await billingApi.cancelSubscription(productId);

      logger.debug(`Subscription canceled successfully`);
      return {
        type: "canceled" as const,
      };
    },
  };
}
