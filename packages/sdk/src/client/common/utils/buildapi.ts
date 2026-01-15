/**
 * Build API Client to manage verifiable builds and provenance
 *
 * This is a standalone HTTP client that talks to the (compute) UserAPI host.
 */

import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { Address, type WalletClient } from "viem";
import { calculateBillingAuthSignature } from "./auth";

const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelay(res: AxiosResponse, attempt: number): number {
  const retryAfter = res.headers["retry-after"];
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      return Math.min(seconds * 1000, MAX_BACKOFF_MS);
    }
  }
  return Math.min(INITIAL_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
}

async function requestWithRetry(config: AxiosRequestConfig): Promise<AxiosResponse> {
  let lastResponse: AxiosResponse | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await axios({ ...config, validateStatus: () => true });
    lastResponse = res;

    if (res.status !== 429) {
      return res;
    }

    if (attempt < MAX_RETRIES) {
      const delay = getRetryDelay(res, attempt);
      await sleep(delay);
    }
  }

  return lastResponse!;
}

export interface BuildApiClientOptions {
  baseUrl: string;
  walletClient?: WalletClient;
  clientId?: string;
  /** Use session-based auth (cookies) instead of signature-based auth */
  useSession?: boolean;
}

export class BuildApiClient {
  private readonly baseUrl: string;
  private readonly walletClient?: WalletClient;
  private readonly clientId?: string;
  private readonly useSession: boolean;

  constructor(options: BuildApiClientOptions) {
    // Strip trailing slashes without regex to avoid ReDoS
    let url = options.baseUrl;
    while (url.endsWith("/")) {
      url = url.slice(0, -1);
    }
    this.baseUrl = url;
    this.clientId = options.clientId;
    this.walletClient = options.walletClient;
    this.useSession = options.useSession ?? false;
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

  /**
   * Submit a new build request. Requires signature auth for billing verification.
   */
  async submitBuild(payload: {
    repo_url: string;
    git_ref: string;
    dockerfile_path: string;
    caddyfile_path?: string;
    build_context_path: string;
    dependencies: string[];
  }): Promise<{ build_id: string }> {
    // Always use signature auth - the server requires it to verify subscription via billing API
    return this.signatureAuthJsonRequest<{ build_id: string }>("/builds", "POST", payload);
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

  /**
   * Get build logs. Supports session auth (identity verification only, no billing check).
   */
  async getLogs(buildId: string): Promise<string> {
    return this.sessionOrSignatureTextRequest(`/builds/${encodeURIComponent(buildId)}/logs`);
  }

  async listBuilds(params: {
    billing_address: string;
    limit?: number;
    offset?: number;
  }): Promise<any[]> {
    const res = await requestWithRetry({
      url: `${this.baseUrl}/builds`,
      method: "GET",
      params,
      headers: this.clientId ? { "x-client-id": this.clientId } : undefined,
      timeout: 60_000,
      validateStatus: () => true,
      withCredentials: this.useSession,
    });
    if (res.status < 200 || res.status >= 300) throw buildApiHttpError(res);
    return res.data as any[];
  }

  private async publicJsonRequest(path: string): Promise<any> {
    const res = await requestWithRetry({
      url: `${this.baseUrl}${path}`,
      method: "GET",
      headers: this.clientId ? { "x-client-id": this.clientId } : undefined,
      timeout: 60_000,
      validateStatus: () => true,
      withCredentials: this.useSession,
    });
    if (res.status < 200 || res.status >= 300) throw buildApiHttpError(res);
    return res.data;
  }

  /**
   * Make a request that ALWAYS requires signature auth (for billing verification).
   * Used for endpoints like POST /builds that need to verify subscription status.
   */
  private async signatureAuthJsonRequest<T>(
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

    const res = await requestWithRetry({
      url: `${this.baseUrl}${path}`,
      method,
      headers,
      data: body,
      timeout: 60_000,
      validateStatus: () => true,
      withCredentials: this.useSession,
    });
    if (res.status < 200 || res.status >= 300) throw buildApiHttpError(res);
    return res.data as T;
  }

  /**
   * Make an authenticated request that can use session OR signature auth.
   * When useSession is true, relies on cookies for identity verification.
   * Used for endpoints that only need identity verification (not billing).
   */
  private async sessionOrSignatureTextRequest(path: string): Promise<string> {
    const headers: Record<string, string> = {};
    if (this.clientId) headers["x-client-id"] = this.clientId;

    // When using session auth, rely on cookies instead of signature headers
    if (!this.useSession) {
      if (!this.walletClient?.account) {
        throw new Error("WalletClient with account required for authenticated requests");
      }

      const expiry = BigInt(Math.floor(Date.now() / 1000) + 60);
      const { signature } = await calculateBillingAuthSignature({
        walletClient: this.walletClient,
        product: "compute",
        expiry,
      });
      headers.Authorization = `Bearer ${signature}`;
      headers["X-eigenx-expiry"] = expiry.toString();
      headers["X-Account"] = this.address;
    }

    const res = await requestWithRetry({
      url: `${this.baseUrl}${path}`,
      method: "GET",
      headers,
      timeout: 60_000,
      responseType: "text",
      validateStatus: () => true,
      withCredentials: this.useSession,
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
