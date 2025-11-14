/**
 * UserAPI Client to manage interactions with the coordinator
 */

import { request, Agent as UndiciAgent } from "undici";
import { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EnvironmentConfig } from "../types";
// import { getKMSKeysForEnvironment } from '../../modules/app/deploy/utils/keys';

import { defaultLogger } from "./logger";

export interface AppInfo {
  address: Address;
  status: string;
  ip: string;
  machineType: string;
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
  }>;
}

const MAX_ADDRESS_COUNT = 5;

// Permission constants (matching Go version)
export const CanViewAppLogsPermission = "0x2fd3f2fe" as Hex;
export const CanViewSensitiveAppInfoPermission = "0x0e67b22f" as Hex;

export class UserApiClient {
  private readonly account?: ReturnType<typeof privateKeyToAccount>;

  constructor(
    private readonly config: EnvironmentConfig,
    privateKey?: string | Hex,
  ) {
    if (privateKey) {
      const privateKeyHex =
        typeof privateKey === "string"
          ? ((privateKey.startsWith("0x")
              ? privateKey
              : `0x${privateKey}`) as Hex)
          : privateKey;
      this.account = privateKeyToAccount(privateKeyHex);
    }
  }

  async getInfos(
    appIDs: Address[],
    addressCount = 1,
    logger = defaultLogger,
  ): Promise<AppInfo[]> {
    const count = Math.min(addressCount, MAX_ADDRESS_COUNT);

    const endpoint = `${this.config.userApiServerURL}/info`;
    const url = `${endpoint}?${new URLSearchParams({ apps: appIDs.join(",") })}`;

    const res = await this.makeAuthenticatedRequest(
      url,
      CanViewSensitiveAppInfoPermission,
    );
    const result: AppInfoResponse = await res.json();

    // Print to debug logs
    logger.debug(JSON.stringify(result, undefined, 2));

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
      };
    });
  }

  /**
   * Get available SKUs (instance types) from UserAPI
   */
  async getSKUs(): Promise<{
    skus: Array<{ sku: string; Description: string }>;
  }> {
    const endpoint = `${this.config.userApiServerURL}/skus`;
    const response = await this.makeAuthenticatedRequest(endpoint);

    const result = await response.json();

    // Transform response to match expected format
    return {
      skus: result.skus || result.SKUs || [],
    };
  }

  private async makeAuthenticatedRequest(
    url: string,
    permission?: string,
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    // Add auth headers if permission is specified
    if (permission && this.account) {
      const expiry = BigInt(Math.floor(Date.now() / 1000) + 5 * 60); // 5 minutes
      const authHeaders = await this.generateAuthHeaders(permission, expiry);
      Object.assign(headers, authHeaders);
    }

    try {
      // Use undici directly with TLS config that skips certificate verification
      // This matches the Go implementation which uses InsecureSkipVerify: true
      const insecureAgent = new UndiciAgent({
        connect: {
          rejectUnauthorized: false, // Skip TLS certificate verification
        },
      });

      // Use undici's request directly instead of fetch
      const response = await request(url, {
        method: "GET",
        headers,
        dispatcher: insecureAgent,
        headersTimeout: 30000, // 30 second timeout (matches Go version)
      });

      // Convert undici response to fetch-like Response object
      const status = response.statusCode;
      const statusText = status >= 200 && status < 300 ? "OK" : "Error";

      if (status < 200 || status >= 300) {
        const body = await response.body.text();
        throw new Error(
          `UserAPI request failed: ${status} ${statusText} - ${body}`,
        );
      }

      // Create a Response-like object that works with our code
      return {
        ok: true,
        status,
        statusText,
        json: async () => {
          const text = await response.body.text();
          return JSON.parse(text);
        },
        text: async () => {
          return await response.body.text();
        },
      } as Response;
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
   * Signs a message containing permission and expiry timestamp
   */
  private async generateAuthHeaders(
    permission: string,
    expiry: bigint,
  ): Promise<Record<string, string>> {
    if (!this.account) {
      throw new Error("Private key required for authenticated requests");
    }

    // Create message to sign: permission + expiry
    // Format matches what the backend expects
    const message = `${permission}${expiry.toString(16).padStart(64, "0")}`;

    // Sign the message directly using the account's signMessage method
    // This works for local accounts without needing a wallet client
    const signature = await this.account.signMessage({
      message,
    });

    if (
      !signature ||
      typeof signature !== "string" ||
      !signature.startsWith("0x")
    ) {
      throw new Error(`Invalid signature format: ${signature}`);
    }

    // Extract r, s, v from signature (65 bytes: 32 bytes r + 32 bytes s + 1 byte v)
    const sigBytes = Buffer.from(signature.slice(2), "hex");
    if (sigBytes.length !== 65) {
      throw new Error(
        `Invalid signature length: expected 65 bytes, got ${sigBytes.length}`,
      );
    }

    const r = `0x${sigBytes.slice(0, 32).toString("hex")}`;
    const s = `0x${sigBytes.slice(32, 64).toString("hex")}`;
    const v = sigBytes[64];

    // Return auth headers (format may need adjustment based on backend expectations)
    return {
      "X-Auth-Address": this.account.address,
      "X-Auth-Permission": permission,
      "X-Auth-Expiry": expiry.toString(),
      "X-Auth-Signature-R": r,
      "X-Auth-Signature-S": s,
      "X-Auth-Signature-V": `0x${v.toString(16).padStart(2, "0")}`,
    };
  }
}
