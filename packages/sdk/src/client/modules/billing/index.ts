/**
 * Main Billing namespace entry point
 *
 * Accepts viem's WalletClient which abstracts over both local accounts
 * (privateKeyToAccount) and external signers (MetaMask, etc.).
 */

import type { WalletClient, PublicClient } from "viem";
import { type Address, type Hex, encodeFunctionData } from "viem";

import { BillingApiClient } from "../../common/utils/billingapi";
import { getBillingEnvironmentConfig, getBuildType, getEnvironmentConfig, BASE_SEPOLIA_CHAIN_ID } from "../../common/config/environment";
import { createClients } from "../../common/utils/helpers";
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
  PaymentMethodsResponse,
  CreditPurchaseResponse,
  RedeemCouponResponse,
} from "../../common/types";

export type BillingChain = "ethereum" | "base";

export interface TopUpOpts {
  /** Amount in raw USDC units (6 decimals, e.g. 50_000_000n = 50 USDC) */
  amount: bigint;
  /** Target account for purchaseCreditsFor (defaults to wallet address) */
  account?: Address;
  /** Which blockchain to transact on (defaults to "ethereum") */
  chain?: BillingChain;
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

export interface BillingModule {
  address: Address;
  subscribe: (opts?: SubscriptionOpts) => Promise<SubscribeResponse>;
  getStatus: (opts?: SubscriptionOpts) => Promise<ProductSubscriptionResponse>;
  cancel: (opts?: SubscriptionOpts) => Promise<CancelResponse>;
  /** Read on-chain state needed for top-up */
  getTopUpInfo: (opts?: { chain?: BillingChain }) => Promise<TopUpInfo>;
  /** Purchase credits with USDC on-chain */
  topUp: (opts: TopUpOpts) => Promise<TopUpResult>;
  getPaymentMethods: () => Promise<PaymentMethodsResponse>;
  purchaseCredits: (amountCents: number, paymentMethodId?: string) => Promise<CreditPurchaseResponse>;
  /** Check if Base chain is configured for this environment */
  hasBaseSupport: () => boolean;
  redeemCoupon: (code: string) => Promise<RedeemCouponResponse>;
}

export interface BillingModuleConfig {
  verbose?: boolean;
  walletClient: WalletClient;
  skipTelemetry?: boolean; // Skip telemetry when called from CLI
  publicClient: PublicClient;
  environment: string;
  privateKey?: Hex;
}

export function createBillingModule(config: BillingModuleConfig): BillingModule {
  const { verbose = false, skipTelemetry = false, walletClient, publicClient, environment, privateKey } = config;

  // Get address from wallet client's account
  if (!walletClient.account) {
    throw new Error("WalletClient must have an account attached");
  }
  const address = walletClient.account.address as Address;

  const logger = getLogger(verbose);

  // Get billing environment configuration
  const billingEnvConfig = getBillingEnvironmentConfig(getBuildType());

  // Create billing API client
  const billingApi = new BillingApiClient(billingEnvConfig, walletClient, { verbose });

  // Resolve on-chain config
  const environmentConfig = getEnvironmentConfig(environment);
  if (!environmentConfig.usdcCreditsAddress) {
    throw new Error(`USDCCredits contract address not configured for environment "${environment}"`);
  }
  const usdcCreditsAddress: Address = environmentConfig.usdcCreditsAddress;

  const baseUsdcCreditsAddress = environmentConfig.baseUsdcCreditsAddress;
  const baseRPCURL = environmentConfig.baseRPCURL;

  function resolveChainConfig(chain?: BillingChain): {
    pub: PublicClient;
    wallet: WalletClient;
    creditsAddress: Address;
    envConfig: typeof environmentConfig;
  } {
    if (chain === "base") {
      if (!baseUsdcCreditsAddress || !baseRPCURL) {
        throw new Error(`Base chain not configured for environment "${environment}"`);
      }
      if (!privateKey) {
        throw new Error("Private key required for Base chain transactions");
      }
      const baseClients = createClients({
        privateKey,
        rpcUrl: baseRPCURL,
        chainId: BigInt(BASE_SEPOLIA_CHAIN_ID),
      });
      return {
        pub: baseClients.publicClient as PublicClient,
        wallet: baseClients.walletClient as WalletClient,
        creditsAddress: baseUsdcCreditsAddress,
        envConfig: {
          ...environmentConfig,
          chainID: BigInt(BASE_SEPOLIA_CHAIN_ID),
          defaultRPCURL: baseRPCURL,
        },
      };
    }
    return {
      pub: publicClient,
      wallet: walletClient,
      creditsAddress: usdcCreditsAddress,
      envConfig: environmentConfig,
    };
  }

  const module: BillingModule = {
    address,

    async getTopUpInfo(opts?: { chain?: BillingChain }): Promise<TopUpInfo> {
      const { pub, creditsAddress } = resolveChainConfig(opts?.chain);

      const usdcAddress = await pub.readContract({
        address: creditsAddress,
        abi: USDCCreditsABI,
        functionName: "usdc",
      }) as Address;

      const [minimumPurchase, usdcBalance, currentAllowance] = await Promise.all([
        pub.readContract({
          address: creditsAddress,
          abi: USDCCreditsABI,
          functionName: "minimumPurchase",
        }) as Promise<bigint>,
        pub.readContract({
          address: usdcAddress,
          abi: ERC20ABI,
          functionName: "balanceOf",
          args: [address],
        }) as Promise<bigint>,
        pub.readContract({
          address: usdcAddress,
          abi: ERC20ABI,
          functionName: "allowance",
          args: [address, creditsAddress],
        }) as Promise<bigint>,
      ]);

      return { usdcAddress, minimumPurchase, usdcBalance, currentAllowance };
    },

    async topUp(opts: TopUpOpts): Promise<TopUpResult> {
      return withSDKTelemetry(
        {
          functionName: "topUp",
          skipTelemetry,
          properties: { amount: opts.amount.toString(), chain: opts.chain || "ethereum" },
        },
        async () => {
          const targetAccount = opts.account ?? address;
          const { pub, wallet, creditsAddress, envConfig } = resolveChainConfig(opts.chain);

          // Read on-chain state
          const { usdcAddress, currentAllowance } = await module.getTopUpInfo({ chain: opts.chain });

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
                args: [creditsAddress, opts.amount],
              }),
            });
          }

          // Always include purchaseCreditsFor
          executions.push({
            target: creditsAddress,
            value: 0n,
            callData: encodeFunctionData({
              abi: USDCCreditsABI,
              functionName: "purchaseCreditsFor",
              args: [opts.amount, targetAccount],
            }),
          });

          const txHash = await executeBatch(
            {
              walletClient: wallet,
              publicClient: pub,
              environmentConfig: envConfig,
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

    async getPaymentMethods() {
      return billingApi.getPaymentMethods();
    },

    async purchaseCredits(amountCents: number, paymentMethodId?: string) {
      return billingApi.purchaseCredits(amountCents, paymentMethodId);
    },

    hasBaseSupport(): boolean {
      return !!baseUsdcCreditsAddress && !!baseRPCURL;
    },

    async redeemCoupon(code: string) {
      return billingApi.redeemCoupon(code);
    },
  };

  return module;
}
