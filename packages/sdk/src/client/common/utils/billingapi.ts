/**
 * BillingAPI Client to manage product subscriptions
 * Standalone client - does not depend on chain infrastructure
 *
 * Supports two modes:
 * 1. Private key mode (BillingApiClient): Uses privateKey for signing
 * 2. WithSigner mode (BillingApiClientWithSigner): Uses signTypedData callback from external signer
 */

import axios, { AxiosResponse } from "axios";
import { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ProductID, CreateSubscriptionResponse, ProductSubscriptionResponse } from "../types";
import { calculateBillingAuthSignature, calculateBillingAuthSignatureWithSigner } from "./auth";
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

/**
 * BillingAPI Client with external signer
 * Uses signTypedData callback instead of private key
 */
export class BillingApiClientWithSigner {
  constructor(
    private readonly config: BillingEnvironmentConfig,
    private readonly signTypedData: (params: {
      domain: { name: string; version: string };
      types: { BillingAuth: Array<{ name: string; type: string }> };
      primaryType: "BillingAuth";
      message: { product: string; expiry: bigint };
    }) => Promise<Hex>,
    private readonly address: Address,
  ) {}

  async createSubscription(productId: ProductID = "compute"): Promise<CreateSubscriptionResponse> {
    const endpoint = `${this.config.billingApiServerURL}/products/${productId}/subscription`;
    const resp = await this.makeAuthenticatedRequest(endpoint, "POST", productId);
    return resp.json() as Promise<CreateSubscriptionResponse>;
  }

  async getSubscription(productId: ProductID = "compute"): Promise<ProductSubscriptionResponse> {
    const endpoint = `${this.config.billingApiServerURL}/products/${productId}/subscription`;
    const resp = await this.makeAuthenticatedRequest(endpoint, "GET", productId);
    return resp.json() as Promise<ProductSubscriptionResponse>;
  }

  async cancelSubscription(productId: ProductID = "compute"): Promise<void> {
    const endpoint = `${this.config.billingApiServerURL}/products/${productId}/subscription`;
    await this.makeAuthenticatedRequest(endpoint, "DELETE", productId);
  }

  private async makeAuthenticatedRequest(
    url: string,
    method: "GET" | "POST" | "DELETE",
    productId: ProductID,
  ): Promise<{ json: () => Promise<unknown>; text: () => Promise<string> }> {
    // Calculate expiry (5 minutes from now)
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 5 * 60);

    // Use EIP-712 typed data signature for billing auth
    const { signature } = await calculateBillingAuthSignatureWithSigner({
      signTypedData: this.signTypedData,
      product: productId,
      expiry,
    });

    // Prepare headers
    const headers: Record<string, string> = {
      Authorization: `Bearer ${signature}`,
      "X-Account": this.address,
      "X-Expiry": expiry.toString(),
    };

    try {
      const response: AxiosResponse = await axios({
        method,
        url,
        headers,
        timeout: 30_000,
        maxRedirects: 0,
        validateStatus: () => true,
      });

      const status = response.status;
      const statusText = status >= 200 && status < 300 ? "OK" : "Error";

      if (status < 200 || status >= 300) {
        const body =
          typeof response.data === "string" ? response.data : JSON.stringify(response.data);
        throw new Error(`BillingAPI request failed: ${status} ${statusText} - ${body}`);
      }

      return {
        json: async () => response.data,
        text: async () =>
          typeof response.data === "string" ? response.data : JSON.stringify(response.data),
      };
    } catch (error: unknown) {
      const err = error as Error & { cause?: { message?: string } };
      if (
        err.message?.includes("fetch failed") ||
        err.message?.includes("ECONNREFUSED") ||
        err.message?.includes("ENOTFOUND") ||
        err.cause
      ) {
        const cause = err.cause?.message || err.cause || err.message;
        throw new Error(
          `Failed to connect to BillingAPI at ${url}: ${cause}\n` +
            `Please check:\n` +
            `1. Your internet connection\n` +
            `2. The API server is accessible: ${this.config.billingApiServerURL}\n` +
            `3. Firewall/proxy settings`,
        );
      }
      throw error;
    }
  }
}
