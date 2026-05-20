/**
 * Contract watcher
 *
 * Watches app status until it reaches Running state using UserAPI.
 */

import { Address } from "viem";
import type { WalletClient, PublicClient } from "viem";
import { EnvironmentConfig, Logger } from "../types";
import { UserApiClient } from "../utils/userapi";

/**
 * Options for watching app status
 */
export interface WatchUntilRunningOptions {
  walletClient: WalletClient;
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  appId: Address;
  /**
   * Maximum seconds to wait before throwing {@link WatchTimeoutError}.
   * Precedence: explicit value > `ECLOUD_WATCH_TIMEOUT_SECONDS` env var > 600s default.
   */
  timeoutSeconds?: number;
}

const WATCH_POLL_INTERVAL_SECONDS = 5;
const WATCH_HEARTBEAT_INTERVAL_SECONDS = 30;
export const WATCH_DEFAULT_TIMEOUT_SECONDS = 10 * 60;
const APP_STATUS_RUNNING = "Running";
const APP_STATUS_FAILED = "Failed";
// const APP_STATUS_DEPLOYING = 'Deploying';

/**
 * Typed error thrown when watch loops exceed their timeout budget.
 *
 * Callers (e.g. the CLI) can catch this specifically to surface a
 * troubleshooting hint without treating it as a generic failure.
 */
export class WatchTimeoutError extends Error {
  public readonly appId: string;
  public readonly elapsedSeconds: number;
  public readonly lastStatus: string | undefined;
  public readonly timeoutSeconds: number;

  constructor(args: {
    appId: string;
    elapsedSeconds: number;
    lastStatus: string | undefined;
    timeoutSeconds: number;
    message?: string;
  }) {
    super(
      args.message ??
        `Timed out after ${args.elapsedSeconds}s waiting for app ${args.appId} (last status: ${args.lastStatus ?? "unknown"})`,
    );
    this.name = "WatchTimeoutError";
    this.appId = args.appId;
    this.elapsedSeconds = args.elapsedSeconds;
    this.lastStatus = args.lastStatus;
    this.timeoutSeconds = args.timeoutSeconds;
  }
}

/**
 * Resolve the watch timeout in seconds, honoring the
 * ECLOUD_WATCH_TIMEOUT_SECONDS environment override.
 */
function resolveWatchTimeoutSeconds(explicit?: number): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  const raw = process.env.ECLOUD_WATCH_TIMEOUT_SECONDS;
  if (raw === undefined || raw === "") {
    return WATCH_DEFAULT_TIMEOUT_SECONDS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return WATCH_DEFAULT_TIMEOUT_SECONDS;
  }
  return Math.floor(parsed);
}

/**
 * Watch app until it reaches Running status with IP address
 */
export async function watchUntilRunning(
  options: WatchUntilRunningOptions,
  logger: Logger,
): Promise<string | undefined> {
  const { walletClient, publicClient, environmentConfig, appId } = options;

  // Create UserAPI client
  const userApiClient = new UserApiClient(environmentConfig, walletClient, publicClient);

  // Track initial status and whether we've seen a change
  let initialStatus: string | undefined;
  let initialIP: string | undefined;
  let hasChanged = false;

  // Stop condition: Running status with IP (but only after seeing a change if starting from Running)
  const stopCondition = (status: string, ip: string): boolean => {
    // Capture initial state on first call
    if (!initialStatus) {
      initialStatus = status;
      initialIP = ip;
    }

    // Track if status has changed from initial
    if (status !== initialStatus) {
      hasChanged = true;
    }

    // Exit on Running with IP, but only if:
    // - We've seen a status change (handles upgrades), OR
    // - Initial status was not Running (handles fresh deploys)
    if (status === APP_STATUS_RUNNING && ip) {
      if (hasChanged || initialStatus !== APP_STATUS_RUNNING) {
        // Only log IP if we didn't have one initially
        if (!initialIP || initialIP === "No IP assigned") {
          logger.info(`App is now running with IP: ${ip}`);
        } else {
          logger.info("App is now running");
        }
        return true;
      }
    }

    // Check for failure states
    if (status === APP_STATUS_FAILED) {
      throw new Error(`App entered ${status} state`);
    }

    return false;
  };

  // Main watch loop
  const startTime = Date.now();
  const timeoutSeconds = resolveWatchTimeoutSeconds(options.timeoutSeconds);
  let lastLoggedStatus: string | undefined;
  let lastHeartbeatAt = startTime;
  while (true) {
    const elapsedMs = Date.now() - startTime;
    const elapsed = Math.round(elapsedMs / 1000);

    // Bound the loop: surface a typed timeout so callers can hint the user.
    if (elapsed >= timeoutSeconds) {
      throw new WatchTimeoutError({
        appId,
        elapsedSeconds: elapsed,
        lastStatus: lastLoggedStatus,
        timeoutSeconds,
      });
    }

    try {
      // Fetch app info
      const info = await userApiClient.getInfos([appId], 1);
      if (info.length === 0) {
        await sleep(WATCH_POLL_INTERVAL_SECONDS * 1000);
        continue;
      }

      const appInfo = info[0];
      const currentStatus = appInfo.status;
      const currentIP = appInfo.ip || "";

      // Log status transitions, plus a periodic heartbeat so non-TTY
      // stdout (where carriage-return updates are invisible) still shows
      // progress when the status string is unchanged for a long time.
      if (currentStatus !== lastLoggedStatus) {
        logger.info(`Status: ${currentStatus} (${elapsed}s)`);
        lastLoggedStatus = currentStatus;
        lastHeartbeatAt = Date.now();
      } else if (Date.now() - lastHeartbeatAt >= WATCH_HEARTBEAT_INTERVAL_SECONDS * 1000) {
        logger.info(`Status: ${currentStatus} (${elapsed}s)`);
        lastHeartbeatAt = Date.now();
      }

      // Check stop condition
      if (stopCondition(currentStatus, currentIP)) {
        return currentIP || undefined;
      }

      // Wait before next poll
      await sleep(WATCH_POLL_INTERVAL_SECONDS * 1000);
    } catch (error: any) {
      // Re-throw typed terminal errors so the caller can react to them.
      if (error instanceof WatchTimeoutError) {
        throw error;
      }
      logger.warn(`Failed to fetch app info: ${error.message}`);
      await sleep(WATCH_POLL_INTERVAL_SECONDS * 1000);
    }
  }
}

/**
 * Options for watching upgrade completion
 */
export interface WatchUntilUpgradeCompleteOptions {
  walletClient: WalletClient;
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  appId: Address;
}

const APP_STATUS_STOPPED = "Stopped";

/**
 * Watch app until upgrade completes
 * For upgrades, we watch until the app reaches Stopped status (upgrade complete)
 * or Running status (if it was running before upgrade)
 */
export async function watchUntilUpgradeComplete(
  options: WatchUntilUpgradeCompleteOptions,
  logger: Logger,
): Promise<void> {
  const { walletClient, publicClient, environmentConfig, appId } = options;

  // Create UserAPI client
  const userApiClient = new UserApiClient(environmentConfig, walletClient, publicClient);

  // Track initial status and whether we've seen a change
  let initialStatus: string | undefined;
  let initialIP: string | undefined;
  let hasChanged = false;

  // Stop condition: Watch for upgrade completion
  const stopCondition = (status: string, ip: string): boolean => {
    // Capture initial state on first call
    if (!initialStatus) {
      initialStatus = status;
      initialIP = ip;

      // If app is already stopped with IP, upgrade is complete
      if (status === APP_STATUS_STOPPED && ip) {
        logger.info("App upgrade complete.");
        logger.info(`Status: ${status}`);
        logger.info(`To start the app, run: ecloud compute app start ${appId}`);
        return true;
      }
    }

    // Track if status has changed from initial
    if (status !== initialStatus) {
      hasChanged = true;
    }

    // Exit on Stopped status with IP after seeing a change (upgrade complete)
    if (status === APP_STATUS_STOPPED && ip && hasChanged) {
      logger.info("App upgrade complete.");
      logger.info(`Status: ${status}`);
      logger.info(`To start the app, run: ecloud compute app start ${appId}`);
      return true;
    }

    // Exit on Running status with IP after seeing a change (upgrade complete and app restarted)
    if (status === APP_STATUS_RUNNING && ip && hasChanged) {
      if (!initialIP || initialIP === "No IP assigned") {
        logger.info(`App is now running with IP: ${ip}`);
      } else {
        logger.info("App is now running");
      }
      return true;
    }

    // Check for failure states
    if (status === APP_STATUS_FAILED) {
      throw new Error(`App entered ${status} state`);
    }

    return false;
  };

  // Main watch loop
  while (true) {
    try {
      // Fetch app info
      const info = await userApiClient.getInfos([appId], 1);
      if (info.length === 0) {
        await sleep(WATCH_POLL_INTERVAL_SECONDS * 1000);
        continue;
      }

      const appInfo = info[0];
      const currentStatus = appInfo.status;
      const currentIP = appInfo.ip || "";

      // Check stop condition
      if (stopCondition(currentStatus, currentIP)) {
        return;
      }

      // Wait before next poll
      await sleep(WATCH_POLL_INTERVAL_SECONDS * 1000);
    } catch (error: any) {
      logger.warn(`Failed to fetch app info: ${error.message}`);
      await sleep(WATCH_POLL_INTERVAL_SECONDS * 1000);
    }
  }
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
