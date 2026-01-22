/**
 * Main Billing namespace entry point
 *
 * Accepts viem's WalletClient which abstracts over both local accounts
 * (privateKeyToAccount) and external signers (MetaMask, etc.).
 */

import type { WalletClient } from "viem";

import { BillingApiClient } from "../../common/utils/billingapi";
import { getBillingEnvironmentConfig, getBuildType } from "../../common/config/environment";
import { getLogger, isSubscriptionActive } from "../../common/utils";
import { withSDKTelemetry } from "../../common/telemetry/wrapper";

import type { Address } from "viem";
import type {
  ProductID,
  SubscriptionOpts,
  SubscribeResponse,
  CancelResponse,
  ProductSubscriptionResponse,
  EigenAISubscriptionOpts,
  EigenAISubscribeResponse,
} from "../../common/types";
import { generateApiKey } from "../../common/utils/apikey";

export interface BillingModule {
  address: Address;
  subscribe: (opts?: SubscriptionOpts) => Promise<SubscribeResponse>;
  subscribeEigenAI: (opts: EigenAISubscriptionOpts) => Promise<EigenAISubscribeResponse>;
  getStatus: (opts?: SubscriptionOpts) => Promise<ProductSubscriptionResponse>;
  cancel: (opts?: SubscriptionOpts) => Promise<CancelResponse>;
}

export interface BillingModuleConfig {
  verbose?: boolean;
  walletClient: WalletClient;
  skipTelemetry?: boolean; // Skip telemetry when called from CLI
}

export function createBillingModule(config: BillingModuleConfig): BillingModule {
  const { verbose = false, skipTelemetry = false, walletClient } = config;

  // Get address from wallet client's account
  if (!walletClient.account) {
    throw new Error("WalletClient must have an account attached");
  }
  const address = walletClient.account.address as Address;

  const logger = getLogger(verbose);

  // Get billing environment configuration
  const billingEnvConfig = getBillingEnvironmentConfig(getBuildType());

  // Create billing API client
  const billingApi = new BillingApiClient(billingEnvConfig, walletClient);

  return {
    address,
    async subscribe(opts) {
      return withSDKTelemetry(
        {
          functionName: "subscribe",
          skipTelemetry: skipTelemetry, // Skip if called from CLI
          properties: { productId: opts?.productId || "compute" },
        },
        async () => {
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
          if (
            currentStatus.subscriptionStatus === "past_due" ||
            currentStatus.subscriptionStatus === "unpaid"
          ) {
            logger.debug(`Subscription has payment issue: ${currentStatus.subscriptionStatus}`);
            return {
              type: "payment_issue" as const,
              status: currentStatus.subscriptionStatus,
              portalUrl: currentStatus.portalUrl,
            };
          }

          // Create new checkout session
          logger.debug(`Creating subscription for ${productId}...`);
          const result = await billingApi.createSubscription(productId, {
            successUrl: opts?.successUrl,
            cancelUrl: opts?.cancelUrl,
          });

          logger.debug(`Checkout URL: ${result.checkoutUrl}`);
          return {
            type: "checkout_created" as const,
            checkoutUrl: result.checkoutUrl,
          };
        },
      );
    },

    async subscribeEigenAI(opts: EigenAISubscriptionOpts) {
      return withSDKTelemetry(
        {
          functionName: "subscribeEigenAI",
          skipTelemetry: skipTelemetry,
          properties: { productId: "eigenai", chainId: opts.chainId },
        },
        async () => {
          // Check existing subscription status first
          logger.debug(`Checking existing subscription for eigenai...`);
          const currentStatus = await billingApi.getSubscription("eigenai");

          // If already active or trialing, don't create new checkout
          if (isSubscriptionActive(currentStatus.subscriptionStatus)) {
            logger.debug(`Subscription already active: ${currentStatus.subscriptionStatus}`);
            return {
              type: "already_active" as const,
              status: currentStatus.subscriptionStatus,
            };
          }

          // If subscription has payment issues, return portal URL instead
          if (
            currentStatus.subscriptionStatus === "past_due" ||
            currentStatus.subscriptionStatus === "unpaid"
          ) {
            logger.debug(`Subscription has payment issue: ${currentStatus.subscriptionStatus}`);
            return {
              type: "payment_issue" as const,
              status: currentStatus.subscriptionStatus,
              portalUrl: currentStatus.portalUrl,
            };
          }

          // Generate API key and hash
          logger.debug(`Generating API key for EigenAI subscription...`);
          const { apiKey, apiKeyHash } = generateApiKey();

          // Create new checkout session with EigenAI-specific parameters
          logger.debug(`Creating EigenAI subscription with chainId: ${opts.chainId}...`);
          const result = await billingApi.createEigenAISubscription({
            chainId: opts.chainId,
            apiKeyHash,
            successUrl: opts.successUrl,
            cancelUrl: opts.cancelUrl,
          });

          logger.debug(`Checkout URL: ${result.checkoutUrl}`);
          return {
            type: "checkout_created" as const,
            checkoutUrl: result.checkoutUrl,
            apiKey, // Return the API key to the caller - only shown once!
          };
        },
      );
    },

    async getStatus(opts) {
      return withSDKTelemetry(
        {
          functionName: "getStatus",
          skipTelemetry: skipTelemetry, // Skip if called from CLI
          properties: { productId: opts?.productId || "compute" },
        },
        async () => {
          const productId: ProductID = opts?.productId || "compute";
          logger.debug(`Fetching subscription status for ${productId}...`);

          const result = await billingApi.getSubscription(productId);

          logger.debug(`Subscription status: ${result.subscriptionStatus}`);
          return result;
        },
      );
    },

    async cancel(opts) {
      return withSDKTelemetry(
        {
          functionName: "cancel",
          skipTelemetry: skipTelemetry, // Skip if called from CLI
          properties: { productId: opts?.productId || "compute" },
        },
        async () => {
          const productId: ProductID = opts?.productId || "compute";

          // Check existing subscription status first
          logger.debug(`Checking subscription status for ${productId}...`);
          const currentStatus = await billingApi.getSubscription(productId);

          // If no active subscription, don't attempt to cancel
          if (!isSubscriptionActive(currentStatus.subscriptionStatus)) {
            logger.debug(`No active subscription to cancel: ${currentStatus.subscriptionStatus}`);
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
      );
    },
  };
}
