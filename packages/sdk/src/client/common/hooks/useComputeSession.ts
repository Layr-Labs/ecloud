/**
 * React Hook for Compute API Session Management
 *
 * This hook provides a convenient way to manage compute API sessions in React applications.
 * It handles session state, auto-refresh, and provides login/logout methods.
 *
 * IMPORTANT: This hook requires React 18+ as a peer dependency.
 * Make sure your application has React installed.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Hex } from "viem";
import {
  ComputeApiConfig,
  getComputeApiSession,
  loginToComputeApi,
  logoutFromComputeApi,
  SessionError,
  SessionInfo,
} from "../auth/session";
import { createSiweMessage, SiweMessageParams } from "../auth/siwe";

export interface UseComputeSessionConfig extends ComputeApiConfig {
  /**
   * Interval in milliseconds to check session validity
   * Set to 0 to disable auto-refresh
   * @default 60000 (1 minute)
   */
  refreshInterval?: number;

  /**
   * Whether to automatically check session on mount
   * @default true
   */
  checkOnMount?: boolean;

  /**
   * Callback when session expires or becomes invalid
   */
  onSessionExpired?: () => void;

  /**
   * Callback when session is successfully refreshed/validated
   */
  onSessionRefreshed?: (session: SessionInfo) => void;

  /**
   * Callback when an error occurs
   */
  onError?: (error: SessionError) => void;
}

export interface UseComputeSessionReturn {
  /** Current session information */
  session: SessionInfo | null;

  /** Whether the session is currently being loaded/checked */
  isLoading: boolean;

  /** Any error that occurred during session operations */
  error: SessionError | null;

  /** Whether the user is authenticated */
  isAuthenticated: boolean;

  /**
   * Login to compute API with SIWE
   *
   * @param params - SIWE message parameters (address, chainId required)
   * @param signMessage - Function to sign the message (from wagmi's useSignMessage)
   * @returns Login result
   */
  login: (
    params: Omit<SiweMessageParams, "domain" | "uri"> & { domain?: string; uri?: string },
    signMessage: (args: { message: string }) => Promise<Hex>,
  ) => Promise<SessionInfo>;

  /**
   * Logout from compute API
   */
  logout: () => Promise<void>;

  /**
   * Manually refresh/check session status
   */
  refresh: () => Promise<SessionInfo>;

  /**
   * Clear any error state
   */
  clearError: () => void;
}

/**
 * React hook for managing compute API sessions with SIWE authentication
 *
 * @param config - Configuration options including baseUrl and refresh settings
 * @returns Session state and methods for login/logout/refresh
 *
 * @example
 * ```tsx
 * import { useComputeSession } from "@layr-labs/ecloud-sdk/browser";
 * import { useSignMessage, useAccount } from "wagmi";
 *
 * function MyComponent() {
 *   const { address, chainId } = useAccount();
 *   const { signMessageAsync } = useSignMessage();
 *
 *   const {
 *     session,
 *     isLoading,
 *     isAuthenticated,
 *     login,
 *     logout,
 *     error,
 *   } = useComputeSession({
 *     baseUrl: "https://api.eigencloud.xyz",
 *     onSessionExpired: () => console.log("Session expired!"),
 *   });
 *
 *   const handleLogin = async () => {
 *     if (!address || !chainId) return;
 *     await login(
 *       { address, chainId },
 *       signMessageAsync
 *     );
 *   };
 *
 *   if (isLoading) return <div>Loading...</div>;
 *
 *   return (
 *     <div>
 *       {isAuthenticated ? (
 *         <>
 *           <p>Logged in as {session?.address}</p>
 *           <button onClick={logout}>Logout</button>
 *         </>
 *       ) : (
 *         <button onClick={handleLogin}>Login</button>
 *       )}
 *       {error && <p>Error: {error.message}</p>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useComputeSession(config: UseComputeSessionConfig): UseComputeSessionReturn {
  const {
    baseUrl,
    refreshInterval = 60000, // 1 minute default
    checkOnMount = true,
    onSessionExpired,
    onSessionRefreshed,
    onError,
  } = config;

  const [session, setSession] = useState<SessionInfo | null>(null);
  const [isLoading, setIsLoading] = useState(checkOnMount);
  const [error, setError] = useState<SessionError | null>(null);

  // Track if we were previously authenticated (for expiry detection)
  const wasAuthenticatedRef = useRef(false);
  // Track if component is mounted
  const isMountedRef = useRef(true);
  // Track refresh interval
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const apiConfig: ComputeApiConfig = { baseUrl };

  /**
   * Check session status and update state
   */
  const checkSession = useCallback(async (): Promise<SessionInfo> => {
    try {
      const sessionInfo = await getComputeApiSession(apiConfig);

      if (!isMountedRef.current) {
        return sessionInfo;
      }

      setSession(sessionInfo);
      setError(null);

      // Detect session expiry
      if (wasAuthenticatedRef.current && !sessionInfo.authenticated) {
        onSessionExpired?.();
      }

      wasAuthenticatedRef.current = sessionInfo.authenticated;

      if (sessionInfo.authenticated) {
        onSessionRefreshed?.(sessionInfo);
      }

      return sessionInfo;
    } catch (err) {
      if (!isMountedRef.current) {
        throw err;
      }

      const sessionError =
        err instanceof SessionError
          ? err
          : new SessionError(`Failed to check session: ${String(err)}`, "UNKNOWN");

      setError(sessionError);
      onError?.(sessionError);

      // Return unauthenticated session on error
      const fallbackSession: SessionInfo = { authenticated: false };
      setSession(fallbackSession);
      return fallbackSession;
    }
  }, [baseUrl, onSessionExpired, onSessionRefreshed, onError]);

  /**
   * Refresh session (public method)
   */
  const refresh = useCallback(async (): Promise<SessionInfo> => {
    setIsLoading(true);
    try {
      return await checkSession();
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [checkSession]);

  /**
   * Login with SIWE
   */
  const login = useCallback(
    async (
      params: Omit<SiweMessageParams, "domain" | "uri"> & { domain?: string; uri?: string },
      signMessage: (args: { message: string }) => Promise<Hex>,
    ): Promise<SessionInfo> => {
      setIsLoading(true);
      setError(null);

      try {
        // Determine domain and uri
        // In browser, use window.location; otherwise require explicit values
        let domain = params.domain;
        let uri = params.uri;

        if (typeof window !== "undefined") {
          domain = domain || window.location.host;
          uri = uri || window.location.origin;
        }

        if (!domain || !uri) {
          throw new SessionError(
            "domain and uri are required when not in browser environment",
            "INVALID_MESSAGE",
          );
        }

        // Create SIWE message
        const siweMessage = createSiweMessage({
          ...params,
          domain,
          uri,
          statement: params.statement || "Sign in to EigenCloud Compute API",
        });

        // Sign the message
        const signature = await signMessage({ message: siweMessage.message });

        // Login to compute API
        await loginToComputeApi(apiConfig, {
          message: siweMessage.message,
          signature,
        });

        // Fetch and return updated session
        const sessionInfo = await checkSession();

        if (!isMountedRef.current) {
          return sessionInfo;
        }

        wasAuthenticatedRef.current = sessionInfo.authenticated;
        return sessionInfo;
      } catch (err) {
        if (!isMountedRef.current) {
          throw err;
        }

        const sessionError =
          err instanceof SessionError
            ? err
            : new SessionError(`Login failed: ${String(err)}`, "UNKNOWN");

        setError(sessionError);
        onError?.(sessionError);
        throw sessionError;
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [baseUrl, checkSession, onError],
  );

  /**
   * Logout
   */
  const logout = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      await logoutFromComputeApi(apiConfig);

      if (!isMountedRef.current) {
        return;
      }

      const newSession: SessionInfo = { authenticated: false };
      setSession(newSession);
      wasAuthenticatedRef.current = false;
    } catch (err) {
      if (!isMountedRef.current) {
        throw err;
      }

      const sessionError =
        err instanceof SessionError
          ? err
          : new SessionError(`Logout failed: ${String(err)}`, "UNKNOWN");

      setError(sessionError);
      onError?.(sessionError);

      // Still clear session locally even if server logout failed
      setSession({ authenticated: false });
      wasAuthenticatedRef.current = false;
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [baseUrl, onError]);

  /**
   * Clear error state
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Check session on mount
  useEffect(() => {
    isMountedRef.current = true;

    if (checkOnMount) {
      checkSession().finally(() => {
        if (isMountedRef.current) {
          setIsLoading(false);
        }
      });
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [checkOnMount, checkSession]);

  // Set up auto-refresh interval
  useEffect(() => {
    if (refreshInterval <= 0) {
      return;
    }

    // Clear existing interval
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
    }

    // Set up new interval
    refreshIntervalRef.current = setInterval(() => {
      // Only refresh if we think we're authenticated
      if (wasAuthenticatedRef.current) {
        checkSession();
      }
    }, refreshInterval);

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    };
  }, [refreshInterval, checkSession]);

  return {
    session,
    isLoading,
    error,
    isAuthenticated: session?.authenticated ?? false,
    login,
    logout,
    refresh,
    clearError,
  };
}

// Re-export types for convenience
export type { SessionInfo, SessionError, ComputeApiConfig };
