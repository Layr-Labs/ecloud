import axios, { AxiosResponse } from "axios";
import { Address, Hex, type PublicClient, type WalletClient } from "viem";
import { calculatePermissionSignature } from "./auth";
import { EnvironmentConfig } from "../types";
import { stripHexPrefix } from "./helpers";
import {
  loginToComputeApi,
  logoutFromComputeApi,
  getComputeApiSession,
  type LoginRequest,
  type LoginResult,
  type SessionInfo,
} from "../auth/session";

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

// ==================== App Releases (/apps/:id) ====================

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(obj: JsonObject, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

function readNumber(obj: JsonObject, key: string): number | undefined {
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export type AppContractStatus = "STARTED" | "STOPPED" | "TERMINATED" | "SUSPENDED" | string;

export interface AppReleaseBuild {
  buildId?: string;
  billingAddress?: string;
  repoUrl?: string;
  gitRef?: string;
  status?: string;
  buildType?: string;
  imageName?: string;
  imageDigest?: string;
  imageUrl?: string;
  provenanceJson?: unknown;
  provenanceSignature?: string;
  createdAt?: string;
  updatedAt?: string;
  errorMessage?: string;
  dependencies?: Record<string, AppReleaseBuild>;
}

export interface AppRelease {
  appId?: string;
  rmsReleaseId?: string;
  imageDigest?: string;
  registryUrl?: string;
  publicEnv?: string;
  encryptedEnv?: string;
  upgradeByTime?: number;
  createdAt?: string;
  createdAtBlock?: string;
  build?: AppReleaseBuild;
}

export interface AppResponse {
  id: string;
  creator?: string;
  contractStatus?: AppContractStatus;
  releases: AppRelease[];
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

/**
 * Options for UserApiClient
 */
export interface UserApiClientOptions {
  /** Custom client ID for request tracking */
  clientId?: string;
  /**
   * Use SIWE session authentication instead of per-request signatures.
   * When true, requests rely on session cookies set by loginToComputeApi().
   * When false (default), each request is signed individually.
   */
  useSession?: boolean;
}

/**
 * UserAPI Client for interacting with the EigenCloud UserAPI service.
 */
export class UserApiClient {
  private readonly clientId: string;
  private readonly useSession: boolean;

  constructor(
    private readonly config: EnvironmentConfig,
    private readonly walletClient: WalletClient,
    private readonly publicClient: PublicClient,
    options?: UserApiClientOptions,
  ) {
    this.clientId = options?.clientId || getDefaultClientId();
    this.useSession = options?.useSession ?? false;
  }

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
   * Get app details from UserAPI (includes releases and build/provenance info when available).
   *
   * Endpoint: GET /apps/:appAddress
   */
  async getApp(appAddress: Address): Promise<AppResponse> {
    const endpoint = `${this.config.userApiServerURL}/apps/${appAddress}`;
    const res = await this.makeAuthenticatedRequest(endpoint);
    const raw = (await res.json()) as unknown;

    if (!isJsonObject(raw)) {
      throw new Error("Unexpected /apps/:id response: expected object");
    }

    const id = readString(raw, "id");
    if (!id) {
      throw new Error("Unexpected /apps/:id response: missing 'id'");
    }

    const releasesRaw = raw.releases;
    const releases = Array.isArray(releasesRaw)
      ? releasesRaw.map((r) => transformAppRelease(r)).filter((r): r is AppRelease => !!r)
      : [];

    return {
      id,
      creator: readString(raw, "creator"),
      contractStatus: (readString(raw, "contract_status") ?? readString(raw, "contractStatus")) as
        | AppContractStatus
        | undefined,
      releases,
    };
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
      status: app.app_status || app.App_Status || "",
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

    // Add auth headers if not using session auth
    if (!this.useSession) {
      const expiry = BigInt(Math.floor(Date.now() / 1000) + 5 * 60); // 5 minutes
      const authHeaders = await this.generateAuthHeaders(CanUpdateAppProfilePermission, expiry);
      Object.assign(headers, authHeaders);
    }

    try {
      const response: AxiosResponse = await axios.post(endpoint, formData, {
        headers,
        maxRedirects: 0,
        validateStatus: () => true, // Don't throw on any status
        maxContentLength: Infinity, // Allow large file uploads
        maxBodyLength: Infinity, // Allow large file uploads
        withCredentials: true, // Include cookies for session auth
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
    // Add auth headers if permission is specified and not using session auth
    if (permission && !this.useSession) {
      const expiry = BigInt(Math.floor(Date.now() / 1000) + 5 * 60); // 5 minutes
      const authHeaders = await this.generateAuthHeaders(permission, expiry);
      Object.assign(headers, authHeaders);
    }

    try {
      const response: AxiosResponse = await axios.get(url, {
        headers,
        maxRedirects: 0,
        validateStatus: () => true, // Don't throw on any status
        withCredentials: true, // Include cookies for session auth
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
    // Calculate permission signature using shared auth utility
    const { signature } = await calculatePermissionSignature({
      permission,
      expiry,
      appControllerAddress: this.config.appControllerAddress,
      publicClient: this.publicClient,
      walletClient: this.walletClient,
    });

    // Return auth headers
    return {
      Authorization: `Bearer ${stripHexPrefix(signature)}`,
      "X-eigenx-expiry": expiry.toString(),
    };
  }

  // ==========================================================================
  // SIWE Session Management
  // ==========================================================================

  /**
   * Login to the compute API using SIWE (Sign-In with Ethereum)
   *
   * This establishes a session with the compute API by verifying the SIWE message
   * and signature. On success, a session cookie is set in the browser.
   *
   * @param request - Login request containing SIWE message and signature
   * @returns Login result with the authenticated address
   *
   * @example
   * ```typescript
   * import { createSiweMessage } from "@layr-labs/ecloud-sdk/browser";
   *
   * const { message } = createSiweMessage({
   *   address: userAddress,
   *   chainId: 11155111,
   *   domain: window.location.host,
   *   uri: window.location.origin,
   * });
   *
   * const signature = await signMessageAsync({ message });
   * const result = await client.siweLogin({ message, signature });
   * ```
   */
  async siweLogin(request: LoginRequest): Promise<LoginResult> {
    return loginToComputeApi({ baseUrl: this.config.userApiServerURL }, request);
  }

  /**
   * Logout from the compute API
   *
   * This destroys the current session and clears the session cookie.
   *
   * @example
   * ```typescript
   * await client.siweLogout();
   * ```
   */
  async siweLogout(): Promise<void> {
    return logoutFromComputeApi({ baseUrl: this.config.userApiServerURL });
  }

  /**
   * Get the current SIWE session status from the compute API
   *
   * @returns Session information including authentication status and address
   *
   * @example
   * ```typescript
   * const session = await client.getSiweSession();
   * if (session.authenticated) {
   *   console.log(`Logged in as ${session.address}`);
   * }
   * ```
   */
  async getSiweSession(): Promise<SessionInfo> {
    return getComputeApiSession({ baseUrl: this.config.userApiServerURL });
  }
}

function transformAppReleaseBuild(raw: unknown): AppReleaseBuild | undefined {
  if (!isJsonObject(raw)) return undefined;

  const depsRaw = raw.dependencies;
  const deps: Record<string, AppReleaseBuild> | undefined = isJsonObject(depsRaw)
    ? Object.fromEntries(
        Object.entries(depsRaw).flatMap(([digest, depRaw]) => {
          const parsed = transformAppReleaseBuild(depRaw);
          return parsed ? ([[digest, parsed]] as const) : [];
        }),
      )
    : undefined;

  return {
    buildId: readString(raw, "build_id") ?? readString(raw, "buildId"),
    billingAddress: readString(raw, "billing_address") ?? readString(raw, "billingAddress"),
    repoUrl: readString(raw, "repo_url") ?? readString(raw, "repoUrl"),
    gitRef: readString(raw, "git_ref") ?? readString(raw, "gitRef"),
    status: readString(raw, "status"),
    buildType: readString(raw, "build_type") ?? readString(raw, "buildType"),
    imageName: readString(raw, "image_name") ?? readString(raw, "imageName"),
    imageDigest: readString(raw, "image_digest") ?? readString(raw, "imageDigest"),
    imageUrl: readString(raw, "image_url") ?? readString(raw, "imageUrl"),
    provenanceJson: raw.provenance_json ?? raw.provenanceJson,
    provenanceSignature:
      readString(raw, "provenance_signature") ?? readString(raw, "provenanceSignature"),
    createdAt: readString(raw, "created_at") ?? readString(raw, "createdAt"),
    updatedAt: readString(raw, "updated_at") ?? readString(raw, "updatedAt"),
    errorMessage: readString(raw, "error_message") ?? readString(raw, "errorMessage"),
    dependencies: deps,
  };
}

function transformAppRelease(raw: unknown): AppRelease | undefined {
  if (!isJsonObject(raw)) return undefined;

  return {
    appId: readString(raw, "appId") ?? readString(raw, "app_id"),
    rmsReleaseId: readString(raw, "rmsReleaseId") ?? readString(raw, "rms_release_id"),
    imageDigest: readString(raw, "imageDigest") ?? readString(raw, "image_digest"),
    registryUrl: readString(raw, "registryUrl") ?? readString(raw, "registry_url"),
    publicEnv: readString(raw, "publicEnv") ?? readString(raw, "public_env"),
    encryptedEnv: readString(raw, "encryptedEnv") ?? readString(raw, "encrypted_env"),
    upgradeByTime: readNumber(raw, "upgradeByTime") ?? readNumber(raw, "upgrade_by_time"),
    createdAt: readString(raw, "createdAt") ?? readString(raw, "created_at"),
    createdAtBlock: readString(raw, "createdAtBlock") ?? readString(raw, "created_at_block"),
    build: raw.build ? transformAppReleaseBuild(raw.build) : undefined,
  };
}
