/**
 * UserAPI Client to manage interactions with the coordinator
 */

import axios, { AxiosResponse } from "axios";
import FormData from "form-data";
import { Address, Hex, createPublicClient, http } from "viem";
import { calculatePermissionSignature } from "./auth";
import { privateKeyToAccount } from "viem/accounts";
import { EnvironmentConfig } from "../types";
import { addHexPrefix, stripHexPrefix, getChainFromID } from "./helpers";

export interface AppProfileInfo {
  name: string;
  website?: string;
  description?: string;
  xURL?: string;
  imageURL?: string;
}

export interface AppMetrics {
  cpu_utilization_percent?: number;
  memory_utilization_percent?: number;
  memory_used_bytes?: number;
  memory_total_bytes?: number;
}

export interface AppInfo {
  address: Address;
  status: string;
  ip: string;
  machineType: string;
  profile?: AppProfileInfo;
  metrics?: AppMetrics;
}

export interface AppInfoResponse {
  apps: Array<{
    addresses: {
      data: {
        evmAddresses: Address[];
        solanaAddresses: string[];
      };
      signature: string;
    };
    app_status: string;
    ip: string;
    machine_type: string;
    profile?: AppProfileInfo;
    metrics?: AppMetrics;
  }>;
}

const MAX_ADDRESS_COUNT = 5;

// Permission constants
export const CanViewAppLogsPermission = "0x2fd3f2fe" as Hex;
export const CanViewSensitiveAppInfoPermission = "0x0e67b22f" as Hex;
export const CanUpdateAppProfilePermission = "0x036fef61" as Hex;

export class UserApiClient {
  private readonly account?: ReturnType<typeof privateKeyToAccount>;
  private readonly rpcUrl?: string;

  constructor(
    private readonly config: EnvironmentConfig,
    privateKey?: string | Hex,
    rpcUrl?: string,
  ) {
    if (privateKey) {
      const privateKeyHex = addHexPrefix(privateKey);
      this.account = privateKeyToAccount(privateKeyHex);
    }
    this.rpcUrl = rpcUrl;
  }

  async getInfos(appIDs: Address[], addressCount = 1): Promise<AppInfo[]> {
    const count = Math.min(addressCount, MAX_ADDRESS_COUNT);

    const endpoint = `${this.config.userApiServerURL}/info`;
    const url = `${endpoint}?${new URLSearchParams({ apps: appIDs.join(",") })}`;

    const res = await this.makeAuthenticatedRequest(url, CanViewSensitiveAppInfoPermission);
    const result: AppInfoResponse = await res.json();

    // optional: verify signatures with KMS key
    // const { signingKey } = getKMSKeysForEnvironment(this.config.name);

    // Truncate without mutating the original object
    return result.apps.map((app, i) => {
      // TODO: Implement signature verification
      // const valid = await verifyKMSSignature(appInfo.addresses, signingKey);
      // if (!valid) {
      //   throw new Error(`Invalid signature for app ${appIDs[i]}`);
      // }
      const evm = app.addresses.data.evmAddresses.slice(0, count);
      // const sol = app.addresses.data.solanaAddresses.slice(0, count);
      // If the API ties each `apps[i]` to `appIDs[i]`, use i. Otherwise derive from `evm[0]`
      const inferredAddress = evm[0] ?? appIDs[i] ?? appIDs[0];

      return {
        address: inferredAddress as Address,
        status: app.app_status,
        ip: app.ip,
        machineType: app.machine_type,
        profile: app.profile,
        metrics: app.metrics,
      };
    });
  }

  /**
   * Get available SKUs (instance types) from UserAPI
   */
  async getSKUs(): Promise<{
    skus: Array<{ sku: string; description: string }>;
  }> {
    const endpoint = `${this.config.userApiServerURL}/skus`;
    const response = await this.makeAuthenticatedRequest(endpoint);

    const result = await response.json();

    // Transform response to match expected format
    return {
      skus: result.skus || result.SKUs || [],
    };
  }

  /**
   * Get logs for an app
   */
  async getLogs(appID: Address): Promise<string> {
    const endpoint = `${this.config.userApiServerURL}/logs/${appID}`;
    const response = await this.makeAuthenticatedRequest(endpoint, CanViewAppLogsPermission);
    return await response.text();
  }

  /**
   * Get statuses for apps
   */
  async getStatuses(appIDs: Address[]): Promise<Array<{ address: Address; status: string }>> {
    const endpoint = `${this.config.userApiServerURL}/status`;
    const url = `${endpoint}?${new URLSearchParams({ apps: appIDs.join(",") })}`;
    const response = await this.makeAuthenticatedRequest(url);
    const result = await response.json();

    // Transform response to match expected format
    // The API returns an array of app statuses
    const apps = result.apps || result.Apps || [];
    return apps.map((app: any, i: number) => ({
      address: (app.address || appIDs[i]) as Address,
      status: app.status || app.Status || "",
    }));
  }

  /**
   * Upload app profile information with optional image
   */
  async uploadAppProfile(
    appAddress: Address,
    name: string,
    website?: string,
    description?: string,
    xURL?: string,
    imagePath?: string,
  ): Promise<{
    name: string;
    website?: string;
    description?: string;
    xURL?: string;
    imageURL?: string;
  }> {
    const endpoint = `${this.config.userApiServerURL}/apps/${appAddress}/profile`;

    // Build multipart form data using form-data package
    const formData = new FormData();

    // Add required name field
    formData.append("name", name);

    // Add optional text fields
    if (website) {
      formData.append("website", website);
    }
    if (description) {
      formData.append("description", description);
    }
    if (xURL) {
      formData.append("xURL", xURL);
    }

    // Add optional image file
    if (imagePath) {
      const fs = await import("fs");
      const path = await import("path");
      const fileName = path.basename(imagePath);

      // Read file into buffer
      const fileBuffer = fs.readFileSync(imagePath);
      formData.append("image", fileBuffer, fileName);
    }

    // Make authenticated POST request
    const headers: Record<string, string> = {
      "x-client-id": "ecloud-cli/v0.0.1",
      ...formData.getHeaders(),
    };

    // Add auth headers (Authorization and X-eigenx-expiry)
    if (this.account) {
      const expiry = BigInt(Math.floor(Date.now() / 1000) + 5 * 60); // 5 minutes
      const authHeaders = await this.generateAuthHeaders(CanUpdateAppProfilePermission, expiry);
      Object.assign(headers, authHeaders);
    }

    try {
      // Use axios to post req
      const response: AxiosResponse = await axios.post(endpoint, formData, {
        headers,
        maxRedirects: 0,
        validateStatus: () => true, // Don't throw on any status
        maxContentLength: Infinity, // Allow large file uploads
        maxBodyLength: Infinity, // Allow large file uploads
      });

      const status = response.status;

      if (status !== 200 && status !== 201) {
        const body =
          typeof response.data === "string" ? response.data : JSON.stringify(response.data);

        // Detect Cloudflare challenge page
        if (status === 403 && body.includes("Cloudflare") && body.includes("challenge-platform")) {
          throw new Error(
            `Cloudflare protection is blocking the request. This is likely due to bot detection.\n` +
              `Status: ${status}`,
          );
        }

        throw new Error(
          `UserAPI request failed: ${status} ${status >= 200 && status < 300 ? "OK" : "Error"} - ${body.substring(0, 500)}${body.length > 500 ? "..." : ""}`,
        );
      }

      return response.data;
    } catch (error: any) {
      if (
        error.message?.includes("fetch failed") ||
        error.message?.includes("ECONNREFUSED") ||
        error.message?.includes("ENOTFOUND") ||
        error.cause
      ) {
        const cause = error.cause?.message || error.cause || error.message;
        throw new Error(
          `Failed to connect to UserAPI at ${endpoint}: ${cause}\n` +
            `Please check:\n` +
            `1. Your internet connection\n` +
            `2. The API server is accessible: ${this.config.userApiServerURL}\n` +
            `3. Firewall/proxy settings`,
        );
      }
      throw error;
    }
  }

  private async makeAuthenticatedRequest(
    url: string,
    permission?: Hex,
  ): Promise<{ json: () => Promise<any>; text: () => Promise<string> }> {
    const headers: Record<string, string> = {
      "x-client-id": "ecloud-cli/v0.0.1",
    };
    // Add auth headers if permission is specified
    if (permission && this.account) {
      const expiry = BigInt(Math.floor(Date.now() / 1000) + 5 * 60); // 5 minutes
      const authHeaders = await this.generateAuthHeaders(permission, expiry);
      Object.assign(headers, authHeaders);
    }

    try {
      // Use axios to match
      const response: AxiosResponse = await axios.get(url, {
        headers,
        maxRedirects: 0,
        validateStatus: () => true, // Don't throw on any status
      });

      const status = response.status;
      const statusText = status >= 200 && status < 300 ? "OK" : "Error";

      if (status < 200 || status >= 300) {
        const body =
          typeof response.data === "string" ? response.data : JSON.stringify(response.data);
        throw new Error(`UserAPI request failed: ${status} ${statusText} - ${body}`);
      }

      // Return Response-like object for compatibility
      return {
        json: async () => response.data,
        text: async () =>
          typeof response.data === "string" ? response.data : JSON.stringify(response.data),
      };
    } catch (error: any) {
      // Handle network errors (fetch failed, connection refused, etc.)
      if (
        error.message?.includes("fetch failed") ||
        error.message?.includes("ECONNREFUSED") ||
        error.message?.includes("ENOTFOUND") ||
        error.cause
      ) {
        const cause = error.cause?.message || error.cause || error.message;
        throw new Error(
          `Failed to connect to UserAPI at ${url}: ${cause}\n` +
            `Please check:\n` +
            `1. Your internet connection\n` +
            `2. The API server is accessible: ${this.config.userApiServerURL}\n` +
            `3. Firewall/proxy settings`,
        );
      }
      // Re-throw other errors as-is
      throw error;
    }
  }

  /**
   * Generate authentication headers for UserAPI requests
   */
  private async generateAuthHeaders(
    permission: Hex,
    expiry: bigint,
  ): Promise<Record<string, string>> {
    if (!this.account) {
      throw new Error("Private key required for authenticated requests");
    }

    if (!this.rpcUrl) {
      throw new Error("RPC URL required for authenticated requests");
    }

    const chain = getChainFromID(this.config.chainID);

    const publicClient = createPublicClient({
      chain,
      transport: http(this.rpcUrl),
    });

    // Calculate permission signature using shared auth utility
    const { signature } = await calculatePermissionSignature({
      permission,
      expiry,
      appControllerAddress: this.config.appControllerAddress as Address,
      publicClient,
      account: this.account,
    });

    // Return auth headers
    return {
      Authorization: `Bearer ${stripHexPrefix(signature)}`,
      "X-eigenx-expiry": expiry.toString(),
    };
  }
}
