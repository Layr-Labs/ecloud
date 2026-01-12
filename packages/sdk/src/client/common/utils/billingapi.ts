/**
 * BillingAPI Client to manage product subscriptions
 * Standalone client - does not depend on chain infrastructure
 *
 * Accepts viem's WalletClient which abstracts over both local accounts
 * (privateKeyToAccount) and external signers (MetaMask, etc.).
 */

import axios, { AxiosResponse } from "axios";
import { Address, type WalletClient } from "viem";
import { ProductID, CreateSubscriptionOptions, CreateSubscriptionResponse, ProductSubscriptionResponse } from "../types";
import { calculateBillingAuthSignature } from "./auth";
import { BillingEnvironmentConfig } from "../types";

/**
 * BillingAPI Client for managing product subscriptions.
 */
export class BillingApiClient {
  constructor(
    private readonly config: BillingEnvironmentConfig,
    private readonly walletClient: WalletClient,
  ) {}

  /**
   * Get the address of the connected wallet
   */
  get address(): Address {
    const account = this.walletClient.account;
    if (!account) {
      throw new Error("WalletClient must have an account attached");
    }
    return account.address;
  }

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

  /**
   * Make an authenticated request to the billing API
   */
  private async makeAuthenticatedRequest(
    url: string,
    method: "GET" | "POST" | "DELETE",
    productId: ProductID,
    body?: Record<string, unknown>,
  ): Promise<{ json: () => Promise<any>; text: () => Promise<string> }> {
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
      "X-Account": this.address,
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
