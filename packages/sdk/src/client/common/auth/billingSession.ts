/**
 * Billing API Session Management
 *
 * This module provides utilities for managing authentication sessions with the billing API
 * using SIWE (Sign-In with Ethereum).
 *
 * The billing API now supports the same SIWE-based session authentication as the compute API,
 * allowing users to sign once and authenticate to both APIs simultaneously.
 */

import { Address, Hex } from "viem";

export interface BillingApiConfig {
  /** Base URL of the billing API (e.g., "https://billing.eigencloud.xyz") */
  baseUrl: string;
}

export interface BillingSessionInfo {
  /** Whether the session is authenticated */
  authenticated: boolean;
  /** Authenticated wallet address (if authenticated) */
  address?: Address;
  /** Chain ID used for authentication (if authenticated) */
  chainId?: number;
  /** Unix timestamp when authentication occurred (if authenticated) */
  authenticatedAt?: number;
}

export interface BillingLoginResult {
  /** Whether login was successful */
  success: boolean;
  /** Authenticated wallet address */
  address: Address;
}

export interface BillingLoginRequest {
  /** SIWE message string */
  message: string;
  /** Hex-encoded signature (with or without 0x prefix) */
  signature: Hex | string;
}

/**
 * Error thrown when billing session operations fail
 */
export class BillingSessionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NETWORK_ERROR"
      | "INVALID_SIGNATURE"
      | "INVALID_MESSAGE"
      | "SESSION_EXPIRED"
      | "UNAUTHORIZED"
      | "UNKNOWN",
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "BillingSessionError";
  }
}

/**
 * Strip 0x prefix from hex string if present
 */
function stripHexPrefix(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

/**
 * Parse error response body
 */
async function parseErrorResponse(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error || response.statusText;
  } catch {
    return response.statusText;
  }
}

/**
 * Login to the billing API using SIWE
 *
 * This establishes a session with the billing API by verifying the SIWE message
 * and signature. On success, a session cookie is set in the browser.
 *
 * The billing API accepts the same SIWE message format as the compute API,
 * so users only need to sign once and can send the same message/signature
 * to both APIs.
 *
 * @param config - Billing API configuration
 * @param request - Login request containing SIWE message and signature
 * @returns Login result with the authenticated address
 *
 * @example
 * ```typescript
 * import { createSiweMessage, loginToBillingApi } from "@layr-labs/ecloud-sdk/browser";
 *
 * const { message } = createSiweMessage({
 *   address: userAddress,
 *   chainId: 11155111,
 *   domain: window.location.host,
 *   uri: window.location.origin,
 * });
 *
 * const signature = await signMessageAsync({ message });
 *
 * // Can send to both APIs with the same message/signature
 * const [computeResult, billingResult] = await Promise.all([
 *   loginToComputeApi({ baseUrl: computeApiUrl }, { message, signature }),
 *   loginToBillingApi({ baseUrl: billingApiUrl }, { message, signature }),
 * ]);
 * ```
 */
export async function loginToBillingApi(
  config: BillingApiConfig,
  request: BillingLoginRequest,
): Promise<BillingLoginResult> {
  let response: Response;

  try {
    response = await fetch(`${config.baseUrl}/auth/siwe/login`, {
      method: "POST",
      credentials: "include", // Include cookies for session management
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: request.message,
        signature: stripHexPrefix(request.signature),
      }),
    });
  } catch (error) {
    throw new BillingSessionError(
      `Network error connecting to ${config.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      "NETWORK_ERROR",
    );
  }

  if (!response.ok) {
    const errorMessage = await parseErrorResponse(response);
    const status = response.status;

    if (status === 400) {
      if (errorMessage.toLowerCase().includes("siwe")) {
        throw new BillingSessionError(`Invalid SIWE message: ${errorMessage}`, "INVALID_MESSAGE", status);
      }
      throw new BillingSessionError(`Bad request: ${errorMessage}`, "INVALID_MESSAGE", status);
    }

    if (status === 401) {
      throw new BillingSessionError(`Invalid signature: ${errorMessage}`, "INVALID_SIGNATURE", status);
    }

    throw new BillingSessionError(`Login failed: ${errorMessage}`, "UNKNOWN", status);
  }

  const data = (await response.json()) as { success: boolean; address: string };

  return {
    success: data.success,
    address: data.address as Address,
  };
}

/**
 * Get the current session status from the billing API
 *
 * @param config - Billing API configuration
 * @returns Session information including authentication status and address
 *
 * @example
 * ```typescript
 * const session = await getBillingApiSession({ baseUrl: "https://billing.eigencloud.xyz" });
 * if (session.authenticated) {
 *   console.log(`Logged in as ${session.address}`);
 * }
 * ```
 */
export async function getBillingApiSession(config: BillingApiConfig): Promise<BillingSessionInfo> {
  let response: Response;

  try {
    response = await fetch(`${config.baseUrl}/auth/session`, {
      method: "GET",
      credentials: "include", // Include cookies for session management
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch {
    // Network error - return unauthenticated session
    return {
      authenticated: false,
    };
  }

  // If we get a 401, return unauthenticated session
  if (response.status === 401) {
    return {
      authenticated: false,
    };
  }

  if (!response.ok) {
    const errorMessage = await parseErrorResponse(response);
    throw new BillingSessionError(`Failed to get session: ${errorMessage}`, "UNKNOWN", response.status);
  }

  const data = (await response.json()) as {
    authenticated: boolean;
    address?: string;
    chainId?: number;
    authenticatedAt?: number;
  };

  return {
    authenticated: data.authenticated,
    address: data.address as Address | undefined,
    chainId: data.chainId,
    authenticatedAt: data.authenticatedAt,
  };
}

/**
 * Logout from the billing API
 *
 * This destroys the current session and clears the session cookie.
 *
 * @param config - Billing API configuration
 *
 * @example
 * ```typescript
 * await logoutFromBillingApi({ baseUrl: "https://billing.eigencloud.xyz" });
 * ```
 */
export async function logoutFromBillingApi(config: BillingApiConfig): Promise<void> {
  let response: Response;

  try {
    response = await fetch(`${config.baseUrl}/auth/logout`, {
      method: "POST",
      credentials: "include", // Include cookies for session management
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    throw new BillingSessionError(
      `Network error connecting to ${config.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      "NETWORK_ERROR",
    );
  }

  // Ignore 401 errors during logout (already logged out)
  if (response.status === 401) {
    return;
  }

  if (!response.ok) {
    const errorMessage = await parseErrorResponse(response);
    throw new BillingSessionError(`Logout failed: ${errorMessage}`, "UNKNOWN", response.status);
  }
}

/**
 * Check if a billing session is still valid (not expired)
 *
 * This is a convenience function that checks the session status
 * and returns a boolean.
 *
 * @param config - Billing API configuration
 * @returns True if session is authenticated, false otherwise
 */
export async function isBillingSessionValid(config: BillingApiConfig): Promise<boolean> {
  const session = await getBillingApiSession(config);
  return session.authenticated;
}

/**
 * Login to both compute and billing APIs simultaneously
 *
 * This is a convenience function that sends the same SIWE message and signature
 * to both APIs in parallel, establishing sessions with both services at once.
 *
 * @param computeConfig - Compute API configuration
 * @param billingConfig - Billing API configuration
 * @param request - Login request containing SIWE message and signature
 * @returns Object containing login results for both APIs
 *
 * @example
 * ```typescript
 * import { createSiweMessage, loginToBothApis } from "@layr-labs/ecloud-sdk/browser";
 *
 * const { message } = createSiweMessage({
 *   address: userAddress,
 *   chainId: 11155111,
 *   domain: window.location.host,
 *   uri: window.location.origin,
 * });
 *
 * const signature = await signMessageAsync({ message });
 * const { compute, billing } = await loginToBothApis(
 *   { baseUrl: computeApiUrl },
 *   { baseUrl: billingApiUrl },
 *   { message, signature }
 * );
 * ```
 */
export async function loginToBothApis(
  computeConfig: { baseUrl: string },
  billingConfig: BillingApiConfig,
  request: BillingLoginRequest,
): Promise<{
  compute: BillingLoginResult;
  billing: BillingLoginResult;
}> {
  // Import the compute login function dynamically to avoid circular dependencies
  const { loginToComputeApi } = await import("./session");

  const [compute, billing] = await Promise.all([
    loginToComputeApi(computeConfig, request),
    loginToBillingApi(billingConfig, request),
  ]);

  return { compute, billing };
}

/**
 * Logout from both compute and billing APIs simultaneously
 *
 * @param computeConfig - Compute API configuration
 * @param billingConfig - Billing API configuration
 *
 * @example
 * ```typescript
 * await logoutFromBothApis(
 *   { baseUrl: computeApiUrl },
 *   { baseUrl: billingApiUrl }
 * );
 * ```
 */
export async function logoutFromBothApis(
  computeConfig: { baseUrl: string },
  billingConfig: BillingApiConfig,
): Promise<void> {
  // Import the compute logout function dynamically to avoid circular dependencies
  const { logoutFromComputeApi } = await import("./session");

  await Promise.all([
    logoutFromComputeApi(computeConfig),
    logoutFromBillingApi(billingConfig),
  ]);
}
