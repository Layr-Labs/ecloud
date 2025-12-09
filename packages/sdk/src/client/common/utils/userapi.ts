import axios, { AxiosResponse } from "axios";
import { Address, Hex, createPublicClient, http } from "viem";
import { calculatePermissionSignature, calculatePermissionSignatureWithSigner } from "./auth";
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

export interface DerivedAddress {
  address: string;
  derivationPath: string;
}

export interface AppInfo {
  address: Address;
  status: string;
  ip: string;
  machineType: string;
  profile?: AppProfileInfo;
  metrics?: AppMetrics;
  evmAddresses: DerivedAddress[];
  solanaAddresses: DerivedAddress[];
}

export interface AppInfoResponse {
  apps: Array<{
    addresses: {
      data: {
        evmAddresses: DerivedAddress[];
        solanaAddresses: DerivedAddress[];
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

/**
 * SDK_VERSION_BUILD_TIME is replaced at build time by tsup's define option
 */
// @ts-ignore - SDK_VERSION_BUILD_TIME is injected at build time by tsup
declare const SDK_VERSION_BUILD_TIME: string | undefined;

/**
 * Get the default client ID using the build-time version
 */
function getDefaultClientId(): string {
  // @ts-ignore - SDK_VERSION_BUILD_TIME is injected at build time
  const version = typeof SDK_VERSION_BUILD_TIME !== "undefined" ? SDK_VERSION_BUILD_TIME : "0.0.0";
  return `ecloud-sdk/v${version}`;
}

export class UserApiClient {
  private readonly account?: ReturnType<typeof privateKeyToAccount>;
  private readonly rpcUrl?: string;
  private readonly clientId: string;

  constructor(
    private readonly config: EnvironmentConfig,
    privateKey?: string | Hex,
    rpcUrl?: string,
    clientId?: string,
  ) {
    if (privateKey) {
      const privateKeyHex = addHexPrefix(privateKey);
      this.account = privateKeyToAccount(privateKeyHex);
    }
    this.rpcUrl = rpcUrl;
    this.clientId = clientId || getDefaultClientId();
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
    // API returns apps in the same order as the request, so use appIDs[i] as the address
    return result.apps.map((app, i) => {
      // TODO: Implement signature verification
      // const valid = await verifyKMSSignature(appInfo.addresses, signingKey);
      // if (!valid) {
      //   throw new Error(`Invalid signature for app ${appIDs[i]}`);
      // }

      // Slice derived addresses to requested count
      const evmAddresses = app.addresses?.data?.evmAddresses?.slice(0, count) || [];
      const solanaAddresses = app.addresses?.data?.solanaAddresses?.slice(0, count) || [];

      return {
        address: appIDs[i] as Address,
        status: app.app_status,
        ip: app.ip,
        machineType: app.machine_type,
        profile: app.profile,
        metrics: app.metrics,
        evmAddresses,
        solanaAddresses,
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
   *
   * @param appAddress - The app's contract address
   * @param name - Display name for the app
   * @param options - Optional fields including website, description, xURL, and image
   * @param options.image - Image file as Blob or File (browser: from input element, Node.js: new Blob([buffer]))
   * @param options.imageName - Filename for the image (required if image is provided)
   */
  async uploadAppProfile(
    appAddress: Address,
    name: string,
    options?: {
      website?: string;
      description?: string;
      xURL?: string;
      image?: Blob | File;
      imageName?: string;
    },
  ): Promise<{
    name: string;
    website?: string;
    description?: string;
    xURL?: string;
    imageURL?: string;
  }> {
    const endpoint = `${this.config.userApiServerURL}/apps/${appAddress}/profile`;

    // Build multipart form data using Web FormData API (works in browser and Node.js 18+)
    const formData = new FormData();

    // Add required name field
    formData.append("name", name);

    // Add optional text fields
    if (options?.website) {
      formData.append("website", options.website);
    }
    if (options?.description) {
      formData.append("description", options.description);
    }
    if (options?.xURL) {
      formData.append("xURL", options.xURL);
    }

    // Add optional image file (Blob or File)
    if (options?.image) {
      // If it's a File, use its name; otherwise require imageName
      const fileName =
        options.image instanceof File ? options.image.name : options.imageName || "image";
      formData.append("image", options.image, fileName);
    }

    // Make authenticated POST request
    // Note: Don't set Content-Type header manually - axios will set it with the correct boundary
    const headers: Record<string, string> = {
      "x-client-id": this.clientId,
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
      "x-client-id": this.clientId,
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

/**
 * UserAPI Client with external signer
 * Uses a signMessage callback instead of a private key for signing
 */
export class UserApiClientWithSigner {
  constructor(
    private readonly config: EnvironmentConfig,
    private readonly signMessage: (message: { raw: Hex }) => Promise<Hex>,
    private readonly address: Address,
    private readonly rpcUrl: string,
  ) {}

  async getInfos(appIDs: Address[], addressCount = 1): Promise<AppInfo[]> {
    const count = Math.min(addressCount, MAX_ADDRESS_COUNT);

    const endpoint = `${this.config.userApiServerURL}/info`;
    const url = `${endpoint}?${new URLSearchParams({ apps: appIDs.join(",") })}`;

    const res = await this.makeAuthenticatedRequest(url, CanViewSensitiveAppInfoPermission);
    const result = (await res.json()) as AppInfoResponse;

    return result.apps.map((app, i) => {
      // TODO: Implement signature verification
      // const valid = await verifyKMSSignature(appInfo.addresses, signingKey);
      // if (!valid) {
      //   throw new Error(`Invalid signature for app ${appIDs[i]}`);
      // }

      // Slice derived addresses to requested count
      const evmAddresses = app.addresses?.data?.evmAddresses?.slice(0, count) || [];
      const solanaAddresses = app.addresses?.data?.solanaAddresses?.slice(0, count) || [];

      return {
        address: appIDs[i] as Address,
        status: app.app_status,
        ip: app.ip,
        machineType: app.machine_type,
        profile: app.profile,
        metrics: app.metrics,
        evmAddresses,
        solanaAddresses,
      };
    });
  }

  async getSKUs(): Promise<{
    skus: Array<{ sku: string; description: string }>;
  }> {
    const endpoint = `${this.config.userApiServerURL}/skus`;
    const response = await this.makeAuthenticatedRequest(endpoint);
    const result = (await response.json()) as {
      skus?: Array<{ sku: string; description: string }>;
      SKUs?: Array<{ sku: string; description: string }>;
    };
    return {
      skus: result.skus || result.SKUs || [],
    };
  }

  async getLogs(appID: Address): Promise<string> {
    const endpoint = `${this.config.userApiServerURL}/logs/${appID}`;
    const response = await this.makeAuthenticatedRequest(endpoint, CanViewAppLogsPermission);
    return await response.text();
  }

  async getStatuses(appIDs: Address[]): Promise<Array<{ address: Address; status: string }>> {
    const endpoint = `${this.config.userApiServerURL}/status`;
    const url = `${endpoint}?${new URLSearchParams({ apps: appIDs.join(",") })}`;
    const response = await this.makeAuthenticatedRequest(url);
    const result = (await response.json()) as {
      apps?: Array<{ address?: string; status?: string; Status?: string }>;
      Apps?: Array<{ address?: string; status?: string; Status?: string }>;
    };
    const apps = result.apps || result.Apps || [];
    return apps.map((app, i: number) => ({
      address: (app.address || appIDs[i]) as Address,
      status: app.status || app.Status || "",
    }));
  }

  private async makeAuthenticatedRequest(
    url: string,
    permission?: Hex,
  ): Promise<{ json: () => Promise<unknown>; text: () => Promise<string> }> {
    const headers: Record<string, string> = {
      "x-client-id": "ecloud-dashboard/v0.0.1",
    };

    if (permission) {
      const expiry = BigInt(Math.floor(Date.now() / 1000) + 5 * 60);
      const authHeaders = await this.generateAuthHeaders(permission, expiry);
      Object.assign(headers, authHeaders);
    }

    try {
      const response: AxiosResponse = await axios.get(url, {
        headers,
        maxRedirects: 0,
        validateStatus: () => true,
      });

      const status = response.status;
      const statusText = status >= 200 && status < 300 ? "OK" : "Error";

      if (status < 200 || status >= 300) {
        const body =
          typeof response.data === "string" ? response.data : JSON.stringify(response.data);
        throw new Error(`UserAPI request failed: ${status} ${statusText} - ${body}`);
      }

      return {
        json: async (): Promise<unknown> => response.data,
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
          `Failed to connect to UserAPI at ${url}: ${cause}\n` +
            `Please check:\n` +
            `1. Your internet connection\n` +
            `2. The API server is accessible: ${this.config.userApiServerURL}\n` +
            `3. Firewall/proxy settings`,
        );
      }
      throw error;
    }
  }

  private async generateAuthHeaders(
    permission: Hex,
    expiry: bigint,
  ): Promise<Record<string, string>> {
    const chain = getChainFromID(this.config.chainID);

    const publicClient = createPublicClient({
      chain,
      transport: http(this.rpcUrl),
    });

    const { signature } = await calculatePermissionSignatureWithSigner({
      permission,
      expiry,
      appControllerAddress: this.config.appControllerAddress as Address,
      publicClient,
      signMessage: this.signMessage,
    });

    return {
      Authorization: `Bearer ${stripHexPrefix(signature)}`,
      "X-eigenx-expiry": expiry.toString(),
    };
  }
}
