/**
 * Main Billing namespace entry point
 *
 * Accepts viem's WalletClient which abstracts over both local accounts
 * (privateKeyToAccount) and external signers (MetaMask, etc.).
 */

import type { WalletClient, PublicClient } from "viem";
import { type Address, type Hex, encodeFunctionData } from "viem";

import { BillingApiClient } from "../../common/utils/billingapi";
import { getBillingEnvironmentConfig, getBuildType, getEnvironmentConfig } from "../../common/config/environment";
import { getLogger, isSubscriptionActive } from "../../common/utils";
import { withSDKTelemetry } from "../../common/telemetry/wrapper";
import { executeBatch, type Execution } from "../../common/contract/eip7702";

import USDCCreditsABI from "../../common/abis/USDCCredits.json";
import ERC20ABI from "../../common/abis/ERC20.json";

import type {
  ProductID,
  SubscriptionOpts,
  SubscribeResponse,
  CancelResponse,
  ProductSubscriptionResponse,
  RedeemCodeResponse,
} from "../../common/types";

export interface TopUpOpts {
  /** Amount in raw USDC units (6 decimals, e.g. 50_000_000n = 50 USDC) */
  amount: bigint;
  /** Target account for purchaseCreditsFor (defaults to wallet address) */
  account?: Address;
}

export interface TopUpResult {
  txHash: Hex;
  walletAddress: Address;
}

export interface TopUpInfo {
  usdcAddress: Address;
  minimumPurchase: bigint;
  usdcBalance: bigint;
  currentAllowance: bigint;
}

export interface RedeemCodeOpts {
  code: string;
  productId?: ProductID;
}

export interface BillingModule {
  address: Address;
  subscribe: (opts?: SubscriptionOpts) => Promise<SubscribeResponse>;
  getStatus: (opts?: SubscriptionOpts) => Promise<ProductSubscriptionResponse>;
  cancel: (opts?: SubscriptionOpts) => Promise<CancelResponse>;
  /** Read on-chain state needed for top-up */
  getTopUpInfo: () => Promise<TopUpInfo>;
  /** Purchase credits with USDC on-chain */
  topUp: (opts: TopUpOpts) => Promise<TopUpResult>;
  /** Redeem a promotion code for promotional credits */
  redeemCode: (opts: RedeemCodeOpts) => Promise<RedeemCodeResponse>;
}

export interface BillingModuleConfig {
  verbose?: boolean;
  walletClient: WalletClient;
  skipTelemetry?: boolean; // Skip telemetry when called from CLI
  publicClient: PublicClient;
  environment: string;
}

export function createBillingModule(config: BillingModuleConfig): BillingModule {
  const { verbose = false, skipTelemetry = false, walletClient, publicClient, environment } = config;

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

  // Resolve on-chain config
  const environmentConfig = getEnvironmentConfig(environment);
  const usdcCreditsAddress = environmentConfig.usdcCreditsAddress;
  if (!usdcCreditsAddress) {
    throw new Error(`USDCCredits contract address not configured for environment "${environment}"`);
  }

  const module: BillingModule = {
    address,

    async getTopUpInfo(): Promise<TopUpInfo> {
      const usdcAddress = await publicClient.readContract({
        address: usdcCreditsAddress,
        abi: USDCCreditsABI,
        functionName: "usdc",
      }) as Address;

      const [minimumPurchase, usdcBalance, currentAllowance] = await Promise.all([
        publicClient.readContract({
          address: usdcCreditsAddress,
          abi: USDCCreditsABI,
          functionName: "minimumPurchase",
        }) as Promise<bigint>,
        publicClient.readContract({
          address: usdcAddress,
          abi: ERC20ABI,
          functionName: "balanceOf",
          args: [address],
        }) as Promise<bigint>,
        publicClient.readContract({
          address: usdcAddress,
          abi: ERC20ABI,
          functionName: "allowance",
          args: [address, usdcCreditsAddress],
        }) as Promise<bigint>,
      ]);

      return { usdcAddress, minimumPurchase, usdcBalance, currentAllowance };
    },

    async topUp(opts: TopUpOpts): Promise<TopUpResult> {
      return withSDKTelemetry(
        {
          functionName: "topUp",
          skipTelemetry,
          properties: { amount: opts.amount.toString() },
        },
        async () => {
          const targetAccount = opts.account ?? address;

          // Read on-chain state
          const { usdcAddress, currentAllowance } = await module.getTopUpInfo();

          // Build executions array
          const executions: Execution[] = [];

          // Conditionally include approve if allowance insufficient
          if (currentAllowance < opts.amount) {
            executions.push({
              target: usdcAddress,
              value: 0n,
              callData: encodeFunctionData({
                abi: ERC20ABI,
                functionName: "approve",
                args: [usdcCreditsAddress, opts.amount],
              }),
            });
          }

          // Always include purchaseCreditsFor
          executions.push({
            target: usdcCreditsAddress,
            value: 0n,
            callData: encodeFunctionData({
              abi: USDCCreditsABI,
              functionName: "purchaseCreditsFor",
              args: [opts.amount, targetAccount],
            }),
          });

          const txHash = await executeBatch(
            {
              walletClient,
              publicClient,
              environmentConfig,
              executions,
              pendingMessage: "Submitting credit purchase...",
            },
            logger,
          );

          return { txHash, walletAddress: address };
        },
      );
    },

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

    async redeemCode(opts) {
      return withSDKTelemetry(
        {
          functionName: "redeemCode",
          skipTelemetry,
          properties: { productId: opts.productId || "compute" },
        },
        async () => {
          const productId: ProductID = opts.productId || "compute";
          logger.debug(`Redeeming code for ${productId}...`);
          return billingApi.redeemCode(opts.code, productId);
        },
      );
    },
  };

  return module;
}
