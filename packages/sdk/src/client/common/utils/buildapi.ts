/**
 * Build API Client to manage verifiable builds and provenance
 *
 * This is a standalone HTTP client that talks to the (compute) UserAPI host.
 */

import axios, { AxiosResponse } from "axios";
import { privateKeyToAccount } from "viem/accounts";

import type { Hex } from "viem";
import { calculateBillingAuthSignature } from "./auth";

export class BuildApiClient {
  private readonly baseUrl: string;
  private readonly account?: ReturnType<typeof privateKeyToAccount>;
  private readonly clientId?: string;

  constructor(options: { baseUrl: string; privateKey?: Hex | string; clientId?: string }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.clientId = options.clientId;

    if (options.privateKey) {
      this.account = privateKeyToAccount(options.privateKey as Hex);
    }
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
    if (!this.account) throw new Error("Private key required for authenticated requests");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.clientId) headers["x-client-id"] = this.clientId;

    // Builds API uses BillingAuth signature format (same as Billing API).
    // Keep expiry short to reduce replay window.
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 60);
    const { signature } = await calculateBillingAuthSignature({
      account: this.account,
      product: "compute",
      expiry,
    });
    headers.Authorization = `Bearer ${signature}`;
    headers["X-eigenx-expiry"] = expiry.toString();
    headers["X-Account"] = this.account.address;

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
    if (!this.account) throw new Error("Private key required for authenticated requests");

    const headers: Record<string, string> = {};
    if (this.clientId) headers["x-client-id"] = this.clientId;

    const expiry = BigInt(Math.floor(Date.now() / 1000) + 60);
    const { signature } = await calculateBillingAuthSignature({
      account: this.account,
      product: "compute",
      expiry,
    });
    headers.Authorization = `Bearer ${signature}`;
    headers["X-eigenx-expiry"] = expiry.toString();
    headers["X-Account"] = this.account.address;

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
