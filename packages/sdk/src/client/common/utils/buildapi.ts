/**
 * Build API Client to manage verifiable builds and provenance
 *
 * This is a standalone HTTP client that talks to the (compute) UserAPI host.
 *
 * Accepts viem's WalletClient which abstracts over both local accounts
 * (privateKeyToAccount) and external signers (MetaMask, etc.).
 *
 * @example
 * // CLI usage with private key
 * const { walletClient } = createClients({ privateKey, rpcUrl, chainId });
 * const client = new BuildApiClient({ baseUrl, walletClient });
 *
 * @example
 * // Browser usage with external wallet
 * const walletClient = createWalletClient({ chain, transport: custom(window.ethereum!) });
 * const client = new BuildApiClient({ baseUrl, walletClient });
 */

import axios, { AxiosResponse } from "axios";
import { Address, type WalletClient } from "viem";
import { calculateBillingAuthSignature } from "./auth";

export class BuildApiClient {
  private readonly baseUrl: string;
  private readonly walletClient?: WalletClient;
  private readonly clientId?: string;

  constructor(options: { baseUrl: string; walletClient?: WalletClient; clientId?: string }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.clientId = options.clientId;
    this.walletClient = options.walletClient;
  }

  /**
   * Get the address of the connected wallet
   */
  get address(): Address {
    const account = this.walletClient?.account;
    if (!account) {
      throw new Error("WalletClient must have an account attached");
    }
    return account.address;
  }

  async submitBuild(payload: {
    repo_url: string;
    git_ref: string;
    dockerfile_path: string;
    caddyfile_path?: string;
    build_context_path: string;
    dependencies: string[];
  }): Promise<{ build_id: string }> {
    return this.authenticatedJsonRequest<{ build_id: string }>("/builds", "POST", payload);
  }

  async getBuild(buildId: string): Promise<any> {
    return this.publicJsonRequest(`/builds/${encodeURIComponent(buildId)}`);
  }

  async getBuildByDigest(digest: string): Promise<any> {
    return this.publicJsonRequest(`/builds/image/${encodeURIComponent(digest)}`);
  }

  async verify(identifier: string): Promise<any> {
    return this.publicJsonRequest(`/builds/verify/${encodeURIComponent(identifier)}`);
  }

  async getLogs(buildId: string): Promise<string> {
    return this.authenticatedTextRequest(`/builds/${encodeURIComponent(buildId)}/logs`);
  }

  async listBuilds(params: {
    billing_address: string;
    limit?: number;
    offset?: number;
  }): Promise<any[]> {
    const res: AxiosResponse = await axios({
      url: `${this.baseUrl}/builds`,
      method: "GET",
      params,
      headers: this.clientId ? { "x-client-id": this.clientId } : undefined,
      timeout: 60_000,
      validateStatus: () => true,
    });
    if (res.status < 200 || res.status >= 300) throw buildApiHttpError(res);
    return res.data as any[];
  }

  private async publicJsonRequest(path: string): Promise<any> {
    const res: AxiosResponse = await axios({
      url: `${this.baseUrl}${path}`,
      method: "GET",
      headers: this.clientId ? { "x-client-id": this.clientId } : undefined,
      timeout: 60_000,
      validateStatus: () => true,
    });
    if (res.status < 200 || res.status >= 300) throw buildApiHttpError(res);
    return res.data;
  }

  private async authenticatedJsonRequest<T>(
    path: string,
    method: "POST" | "GET",
    body?: unknown,
  ): Promise<T> {
    if (!this.walletClient?.account) {
      throw new Error("WalletClient with account required for authenticated requests");
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.clientId) headers["x-client-id"] = this.clientId;

    // Builds API uses BillingAuth signature format (same as Billing API).
    // Keep expiry short to reduce replay window.
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 60);
    const { signature } = await calculateBillingAuthSignature({
      walletClient: this.walletClient,
      product: "compute",
      expiry,
    });
    headers.Authorization = `Bearer ${signature}`;
    headers["X-eigenx-expiry"] = expiry.toString();
    headers["X-Account"] = this.address;

    const res: AxiosResponse = await axios({
      url: `${this.baseUrl}${path}`,
      method,
      headers,
      data: body,
      timeout: 60_000,
      validateStatus: () => true,
    });
    if (res.status < 200 || res.status >= 300) throw buildApiHttpError(res);
    return res.data as T;
  }

  private async authenticatedTextRequest(path: string): Promise<string> {
    if (!this.walletClient?.account) {
      throw new Error("WalletClient with account required for authenticated requests");
    }

    const headers: Record<string, string> = {};
    if (this.clientId) headers["x-client-id"] = this.clientId;

    const expiry = BigInt(Math.floor(Date.now() / 1000) + 60);
    const { signature } = await calculateBillingAuthSignature({
      walletClient: this.walletClient,
      product: "compute",
      expiry,
    });
    headers.Authorization = `Bearer ${signature}`;
    headers["X-eigenx-expiry"] = expiry.toString();
    headers["X-Account"] = this.address;

    const res: AxiosResponse = await axios({
      url: `${this.baseUrl}${path}`,
      method: "GET",
      headers,
      timeout: 60_000,
      responseType: "text",
      validateStatus: () => true,
    });
    if (res.status < 200 || res.status >= 300) throw buildApiHttpError(res);
    return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
  }
}

function buildApiHttpError(res: AxiosResponse): Error {
  const status = res.status;
  const body = typeof res.data === "string" ? res.data : res.data ? JSON.stringify(res.data) : "";
  const url = res.config?.url ? ` ${res.config.url}` : "";
  return new Error(`BuildAPI request failed: ${status}${url} - ${body || "Unknown error"}`);
}
