/**
 * BillingAPI Client to manage product subscriptions
 * Standalone client - does not depend on chain infrastructure
 *
 * Accepts viem's WalletClient which abstracts over both local accounts
 * (privateKeyToAccount) and external signers (MetaMask, etc.).
 *
 * Supports two authentication modes:
 * 1. EIP-712 signature auth (default) - signs each request with typed data
 * 2. Session auth (optional) - uses SIWE session cookies
 */

import axios, { AxiosResponse } from "axios";
import { Address, type WalletClient } from "viem";
import { ProductID, CreateSubscriptionOptions, CreateSubscriptionResponse, ProductSubscriptionResponse } from "../types";
import { calculateBillingAuthSignature } from "./auth";
import { BillingEnvironmentConfig } from "../types";
import {
  loginToBillingApi,
  logoutFromBillingApi,
  getBillingApiSession,
  type BillingSessionInfo,
  type BillingLoginResult,
  type BillingLoginRequest,
} from "../auth/billingSession";

export interface BillingApiClientOptions {
  /**
   * Use session-based authentication instead of per-request signatures.
   * When true, the client will rely on session cookies set by SIWE login.
   * When false (default), uses EIP-712 typed data signatures for each request.
   */
  useSession?: boolean;
}

/**
 * BillingAPI Client for managing product subscriptions.
 */
export class BillingApiClient {
  private readonly useSession: boolean;

  constructor(
    private readonly config: BillingEnvironmentConfig,
    private readonly walletClient: WalletClient | null,
    private readonly options: BillingApiClientOptions = {},
  ) {
    this.useSession = options.useSession ?? false;

    // Validate that walletClient is provided when not using session auth
    if (!this.useSession && !walletClient) {
      throw new Error("WalletClient is required when not using session authentication");
    }
  }

  /**
   * Get the address of the connected wallet
   * Returns undefined if using session auth without a wallet client
   */
  get address(): Address | undefined {
    const account = this.walletClient?.account;
    if (!account) {
      if (!this.useSession) {
        throw new Error("WalletClient must have an account attached");
      }
      return undefined;
    }
    return account.address;
  }

  /**
   * Get the base URL of the billing API
   */
  get baseUrl(): string {
    return this.config.billingApiServerURL;
  }

  // ==========================================================================
  // SIWE Session Methods
  // ==========================================================================

  /**
   * Login to the billing API using SIWE
   *
   * This establishes a session with the billing API by verifying the SIWE message
   * and signature. On success, a session cookie is set in the browser.
   *
   * @param request - Login request containing SIWE message and signature
   * @returns Login result with the authenticated address
   *
   * @example
   * ```typescript
   * const { message } = createSiweMessage({
   *   address: userAddress,
   *   chainId: 11155111,
   *   domain: window.location.host,
   *   uri: window.location.origin,
   * });
   *
   * const signature = await signMessageAsync({ message });
   * const result = await billingClient.siweLogin({ message, signature });
   * ```
   */
  async siweLogin(request: BillingLoginRequest): Promise<BillingLoginResult> {
    return loginToBillingApi({ baseUrl: this.baseUrl }, request);
  }

  /**
   * Logout from the billing API
   *
   * This destroys the current session and clears the session cookie.
   */
  async siweLogout(): Promise<void> {
    return logoutFromBillingApi({ baseUrl: this.baseUrl });
  }

  /**
   * Get the current session status from the billing API
   *
   * @returns Session information including authentication status and address
   */
  async getSession(): Promise<BillingSessionInfo> {
    return getBillingApiSession({ baseUrl: this.baseUrl });
  }

  /**
   * Check if there is a valid session
   *
   * @returns True if session is authenticated, false otherwise
   */
  async isSessionValid(): Promise<boolean> {
    const session = await this.getSession();
    return session.authenticated;
  }

  // ==========================================================================
  // Subscription Methods
  // ==========================================================================

  async createSubscription(productId: ProductID = "compute", options?: CreateSubscriptionOptions): Promise<CreateSubscriptionResponse> {
    const endpoint = `${this.config.billingApiServerURL}/products/${productId}/subscription`;
    const body = options ? {
      success_url: options.successUrl,
      cancel_url: options.cancelUrl,
    } : undefined;
    const resp = await this.makeAuthenticatedRequest(endpoint, "POST", productId, body);
    return resp.json();
  }

  async getSubscription(productId: ProductID = "compute"): Promise<ProductSubscriptionResponse> {
    const endpoint = `${this.config.billingApiServerURL}/products/${productId}/subscription`;
    const resp = await this.makeAuthenticatedRequest(endpoint, "GET", productId);
    return resp.json();
  }

  async cancelSubscription(productId: ProductID = "compute"): Promise<void> {
    const endpoint = `${this.config.billingApiServerURL}/products/${productId}/subscription`;
    await this.makeAuthenticatedRequest(endpoint, "DELETE", productId);
  }

  // ==========================================================================
  // Internal Methods
  // ==========================================================================

  /**
   * Make an authenticated request to the billing API
   *
   * Uses session auth if useSession is true, otherwise uses EIP-712 signature auth.
   */
  private async makeAuthenticatedRequest(
    url: string,
    method: "GET" | "POST" | "DELETE",
    productId: ProductID,
    body?: Record<string, unknown>,
  ): Promise<{ json: () => Promise<any>; text: () => Promise<string> }> {
    if (this.useSession) {
      return this.makeSessionAuthenticatedRequest(url, method, body);
    }
    return this.makeSignatureAuthenticatedRequest(url, method, productId, body);
  }

  /**
   * Make a request using session-based authentication (cookies)
   */
  private async makeSessionAuthenticatedRequest(
    url: string,
    method: "GET" | "POST" | "DELETE",
    body?: Record<string, unknown>,
  ): Promise<{ json: () => Promise<any>; text: () => Promise<string> }> {
    const headers: Record<string, string> = {};

    // Add content-type header if body is present
    if (body) {
      headers["Content-Type"] = "application/json";
    }

    try {
      // Use fetch with credentials: 'include' for cookie-based auth
      const response = await fetch(url, {
        method,
        credentials: "include", // Include cookies for session management
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      const status = response.status;
      const statusText = status >= 200 && status < 300 ? "OK" : "Error";

      if (status < 200 || status >= 300) {
        let errorBody: string;
        try {
          errorBody = await response.text();
        } catch {
          errorBody = statusText;
        }
        throw new Error(`BillingAPI request failed: ${status} ${statusText} - ${errorBody}`);
      }

      // Return Response-like object for compatibility
      const responseData = await response.json();
      return {
        json: async () => responseData,
        text: async () => JSON.stringify(responseData),
      };
    } catch (error: any) {
      // Handle network errors
      if (error.name === "TypeError" || error.message?.includes("fetch")) {
        throw new Error(
          `Failed to connect to BillingAPI at ${url}: ${error.message}\n` +
            `Please check:\n` +
            `1. Your internet connection\n` +
            `2. The API server is accessible: ${this.config.billingApiServerURL}\n` +
            `3. Firewall/proxy settings`,
        );
      }
      // Re-throw other errors as-is
      throw error;
    }
  }

  /**
   * Make a request using EIP-712 signature authentication
   */
  private async makeSignatureAuthenticatedRequest(
    url: string,
    method: "GET" | "POST" | "DELETE",
    productId: ProductID,
    body?: Record<string, unknown>,
  ): Promise<{ json: () => Promise<any>; text: () => Promise<string> }> {
    if (!this.walletClient) {
      throw new Error("WalletClient is required for signature authentication");
    }

    // Calculate expiry (5 minutes from now)
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 5 * 60);

    // Use EIP-712 typed data signature for billing auth
    const { signature } = await calculateBillingAuthSignature({
      walletClient: this.walletClient,
      product: productId,
      expiry,
    });

    // Prepare headers
    const headers: Record<string, string> = {
      Authorization: `Bearer ${signature}`,
      "X-Account": this.address!,
      "X-Expiry": expiry.toString(),
    };

    // Add content-type header if body is present
    if (body) {
      headers["Content-Type"] = "application/json";
    }

    try {
      // Use axios to make the request
      const response: AxiosResponse = await axios({
        method,
        url,
        headers,
        data: body,
        timeout: 30_000,
        maxRedirects: 0,
        validateStatus: () => true, // Don't throw on any status
      });

      const status = response.status;
      const statusText = status >= 200 && status < 300 ? "OK" : "Error";

      if (status < 200 || status >= 300) {
        const body =
          typeof response.data === "string" ? response.data : JSON.stringify(response.data);
        throw new Error(`BillingAPI request failed: ${status} ${statusText} - ${body}`);
      }

      // Return Response-like object for compatibility
      return {
        json: async () => response.data,
        text: async () =>
          typeof response.data === "string" ? response.data : JSON.stringify(response.data),
      };
    } catch (error: any) {
      // Handle network errors
      if (
        error.message?.includes("fetch failed") ||
        error.message?.includes("ECONNREFUSED") ||
        error.message?.includes("ENOTFOUND") ||
        error.cause
      ) {
        const cause = error.cause?.message || error.cause || error.message;
        throw new Error(
          `Failed to connect to BillingAPI at ${url}: ${cause}\n` +
            `Please check:\n` +
            `1. Your internet connection\n` +
            `2. The API server is accessible: ${this.config.billingApiServerURL}\n` +
            `3. Firewall/proxy settings`,
        );
      }
      // Re-throw other errors as-is
      throw error;
    }
  }
}
