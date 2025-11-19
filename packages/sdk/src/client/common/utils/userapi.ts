/**
 * UserAPI Client to manage interactions with the coordinator
 */

import { request, Agent as UndiciAgent } from "undici";
import {
  Address,
  Hex,
  concat,
  createPublicClient,
  http,
  keccak256,
  toBytes,
} from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";
import { sepolia, mainnet } from "viem/chains";
import { EnvironmentConfig } from "../types";
import AppControllerABI from "../abis/AppController.json";
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

// Permission constants
export const CanViewAppLogsPermission = "0x2fd3f2fe" as Hex;
export const CanViewSensitiveAppInfoPermission = "0x0e67b22f" as Hex;

export class UserApiClient {
  private readonly account?: ReturnType<typeof privateKeyToAccount>;
  private readonly privateKey?: Hex;
  private readonly rpcUrl?: string;

  constructor(
    private readonly config: EnvironmentConfig,
    privateKey?: string | Hex,
    rpcUrl?: string,
  ) {
    if (privateKey) {
      const privateKeyHex =
        typeof privateKey === "string"
          ? ((privateKey.startsWith("0x")
              ? privateKey
              : `0x${privateKey}`) as Hex)
          : privateKey;
      this.account = privateKeyToAccount(privateKeyHex);
      this.privateKey = privateKeyHex;
    }
    this.rpcUrl = rpcUrl;
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
    const response = await this.makeAuthenticatedRequest(
      endpoint,
      CanViewAppLogsPermission,
    );
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

  private async makeAuthenticatedRequest(
    url: string,
    permission?: Hex,
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
        headersTimeout: 30000, // 30 second timeout
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

    // Get chain from environment config
    const chain =
      this.config.chainID === 11155111n
        ? sepolia
        : this.config.chainID === 1n
          ? mainnet
          : sepolia;

    // Create public client to call contract
    const publicClient = createPublicClient({
      chain,
      transport: http(this.rpcUrl),
    });

    // Call the contract to calculate the digest hash
    const digestHash = (await publicClient.readContract({
      address: this.config.appControllerAddress as Address,
      abi: AppControllerABI,
      functionName: "calculateApiPermissionDigestHash",
      args: [permission, expiry],
    })) as Hex;

    // Apply EIP-191 message signing prefix ("\x19Ethereum Signed Message:\n" + length)
    // Keccak256 concatenates the two byte arrays before hashing
    const messagePrefix = "\x19Ethereum Signed Message:\n32";
    const prefixBytes = toBytes(messagePrefix);
    const digestBytes = toBytes(digestHash);
    const prefixedHash = keccak256(concat([prefixBytes, digestBytes]));

    // Sign the EIP-191 prefixed hash
    if (!this.privateKey) {
      throw new Error("Private key required for signing");
    }
    const signature = await sign({
      hash: prefixedHash,
      privateKey: this.privateKey,
    });

    // Convert signature to hex string format (r + s + v)
    // viem's sign returns {r, s, v} object, we need to convert to 65-byte hex string
    const r = signature.r.slice(2); // Remove 0x
    const s = signature.s.slice(2); // Remove 0x
    const v = Number(signature.v).toString(16).padStart(2, "0");
    const signatureHex = `0x${r}${s}${v}`;

    // Return auth headers
    return {
      Authorization: `Bearer ${signatureHex.slice(2)}`, // Remove 0x prefix
      "X-eigenx-expiry": expiry.toString(),
    };
  }
}
