/**
 * Compute API Session Management
 *
 * This module provides utilities for managing authentication sessions with the compute API
 * using SIWE (Sign-In with Ethereum).
 */

import { Address, Hex } from "viem";

export interface ComputeApiConfig {
  /** Base URL of the compute API (e.g., "https://api.eigencloud.xyz") */
  baseUrl: string;
}

export interface SessionInfo {
  /** Whether the session is authenticated */
  authenticated: boolean;
  /** Authenticated wallet address (if authenticated) */
  address?: Address;
  /** Chain ID used for authentication (if authenticated) */
  chainId?: number;
}

export interface LoginResult {
  /** Whether login was successful */
  success: boolean;
  /** Authenticated wallet address */
  address: Address;
}

export interface LoginRequest {
  /** SIWE message string */
  message: string;
  /** Hex-encoded signature (with or without 0x prefix) */
  signature: Hex | string;
}

/**
 * Error thrown when session operations fail
 */
export class SessionError extends Error {
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
    this.name = "SessionError";
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
 * Login to the compute API using SIWE
 *
 * This establishes a session with the compute API by verifying the SIWE message
 * and signature. On success, a session cookie is set in the browser.
 *
 * @param config - Compute API configuration
 * @param request - Login request containing SIWE message and signature
 * @returns Login result with the authenticated address
 *
 * @example
 * ```typescript
 * import { createSiweMessage, loginToComputeApi } from "@layr-labs/ecloud-sdk/browser";
 *
 * const { message } = createSiweMessage({
 *   address: userAddress,
 *   chainId: 11155111,
 *   domain: window.location.host,
 *   uri: window.location.origin,
 * });
 *
 * const signature = await signMessageAsync({ message });
 * const result = await loginToComputeApi(
 *   { baseUrl: "https://api.eigencloud.xyz" },
 *   { message, signature }
 * );
 * ```
 */
export async function loginToComputeApi(
  config: ComputeApiConfig,
  request: LoginRequest,
): Promise<LoginResult> {
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
    throw new SessionError(
      `Network error connecting to ${config.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      "NETWORK_ERROR",
    );
  }

  if (!response.ok) {
    const errorMessage = await parseErrorResponse(response);
    const status = response.status;

    if (status === 400) {
      if (errorMessage.toLowerCase().includes("siwe")) {
        throw new SessionError(`Invalid SIWE message: ${errorMessage}`, "INVALID_MESSAGE", status);
      }
      throw new SessionError(`Bad request: ${errorMessage}`, "INVALID_MESSAGE", status);
    }

    if (status === 401) {
      throw new SessionError(`Invalid signature: ${errorMessage}`, "INVALID_SIGNATURE", status);
    }

    throw new SessionError(`Login failed: ${errorMessage}`, "UNKNOWN", status);
  }

  const data = (await response.json()) as { success: boolean; address: string };

  return {
    success: data.success,
    address: data.address as Address,
  };
}

/**
 * Get the current session status from the compute API
 *
 * @param config - Compute API configuration
 * @returns Session information including authentication status and address
 *
 * @example
 * ```typescript
 * const session = await getComputeApiSession({ baseUrl: "https://api.eigencloud.xyz" });
 * if (session.authenticated) {
 *   console.log(`Logged in as ${session.address}`);
 * }
 * ```
 */
export async function getComputeApiSession(config: ComputeApiConfig): Promise<SessionInfo> {
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
    throw new SessionError(`Failed to get session: ${errorMessage}`, "UNKNOWN", response.status);
  }

  const data = (await response.json()) as {
    authenticated: boolean;
    address?: string;
    chain_id?: number;
  };

  return {
    authenticated: data.authenticated,
    address: data.address as Address | undefined,
    chainId: data.chain_id,
  };
}

/**
 * Logout from the compute API
 *
 * This destroys the current session and clears the session cookie.
 *
 * @param config - Compute API configuration
 *
 * @example
 * ```typescript
 * await logoutFromComputeApi({ baseUrl: "https://api.eigencloud.xyz" });
 * ```
 */
export async function logoutFromComputeApi(config: ComputeApiConfig): Promise<void> {
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
    throw new SessionError(
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
    throw new SessionError(`Logout failed: ${errorMessage}`, "UNKNOWN", response.status);
  }
}

/**
 * Check if a session is still valid (not expired)
 *
 * This is a convenience function that checks the session status
 * and returns a boolean.
 *
 * @param config - Compute API configuration
 * @returns True if session is authenticated, false otherwise
 */
export async function isSessionValid(config: ComputeApiConfig): Promise<boolean> {
  const session = await getComputeApiSession(config);
  return session.authenticated;
}
