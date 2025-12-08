/**
 * BillingAPI Client to manage product subscriptions
 * Standalone client - does not depend on chain infrastructure
 */

import axios, { AxiosResponse } from "axios";
import { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ProductID, CreateSubscriptionResponse, ProductSubscriptionResponse } from "../types";
import { calculateBillingAuthSignature } from "./auth";
import { BillingEnvironmentConfig } from "../types";

export class BillingApiClient {
  private readonly account: ReturnType<typeof privateKeyToAccount>;
  private readonly config: BillingEnvironmentConfig;

  constructor(config: BillingEnvironmentConfig, privateKey: Hex) {
    this.account = privateKeyToAccount(privateKey);
    this.config = config;
  }

  async createSubscription(productId: ProductID = "compute"): Promise<CreateSubscriptionResponse> {
    const endpoint = `${this.config.billingApiServerURL}/products/${productId}/subscription`;
    const resp = await this.makeAuthenticatedRequest(endpoint, "POST", productId);
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
  ): Promise<{ json: () => Promise<any>; text: () => Promise<string> }> {
    // Calculate expiry (5 minutes from now)
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 5 * 60);

    // Use EIP-712 typed data signature for billing auth
    const { signature } = await calculateBillingAuthSignature({
      account: this.account,
      product: productId,
      expiry,
    });

    // Prepare headers
    const headers: Record<string, string> = {
      Authorization: `Bearer ${signature}`,
      "X-Account": this.account.address,
      "X-Expiry": expiry.toString(),
    };

    try {
      // Use axios to make the request
      const response: AxiosResponse = await axios({
        method,
        url,
        headers,
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
