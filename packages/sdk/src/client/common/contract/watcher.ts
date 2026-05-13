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
}

const WATCH_POLL_INTERVAL_SECONDS = 5;
const APP_STATUS_RUNNING = "Running";
const APP_STATUS_FAILED = "Failed";
// const APP_STATUS_DEPLOYING = 'Deploying';

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
  let lastLoggedStatus: string | undefined;
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

      // Log status changes and elapsed time
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      if (currentStatus !== lastLoggedStatus) {
        logger.info(`Status: ${currentStatus} (${elapsed}s)`);
        lastLoggedStatus = currentStatus;
      }

      // Check stop condition
      if (stopCondition(currentStatus, currentIP)) {
        return currentIP || undefined;
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
 * Options for watching upgrade completion
 */
export interface WatchUntilUpgradeCompleteOptions {
  walletClient: WalletClient;
  publicClient: PublicClient;
  environmentConfig: EnvironmentConfig;
  appId: Address;
}

const APP_STATUS_STOPPED = "Stopped";

/** Human-friendly labels for upgrade phases */
const UPGRADE_PHASE_LABELS: Record<string, string> = {
  provisioning: "Provisioning new instance",
  health_check: "Running health checks",
  draining: "Switching traffic & draining old instance",
  complete: "Complete",
  rolling_back: "Rolling back",
  rollback_done: "Rollback complete",
  db_handoff: "Database handoff",
  // Prewarm-detach phases
  awaiting_userdata: "Waiting for instance readiness",
  draining_old: "Draining old instance",
  detached: "Detaching storage",
  attached_to_new: "Attaching storage to new instance",
  finalizing: "Finalizing new instance",
  flipping: "Switching traffic",
  teardown_old: "Cleaning up old instance",
};

/**
 * Fetch the current upgrade phase for an app by querying the deployments endpoint.
 * Returns the upgrade_phase of the most recent deployment, or undefined if unavailable.
 */
async function fetchUpgradePhase(
  userApiClient: UserApiClient,
  appId: Address,
): Promise<string | undefined> {
  try {
    const deployments = await userApiClient.getDeployments(appId);
    if (deployments.length === 0) return undefined;
    // Deployments are returned newest-first (by created_at desc from the API)
    // but if not, sort by createdAt descending
    const sorted = [...deployments].sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });
    return sorted[0].upgradePhase || undefined;
  } catch {
    // Best-effort: if the endpoint is unavailable, don't block the watcher
    return undefined;
  }
}

/**
 * Watch app until upgrade completes
 * For upgrades, we watch until the app reaches Stopped status (upgrade complete)
 * or Running status (if it was running before upgrade).
 *
 * Provides real-time feedback by polling both the app status and the upgrade phase
 * from the platform's deployment records.
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

  // Track upgrade phase and timing for progress feedback
  const startTime = Date.now();
  let lastLoggedStatus: string | undefined;
  let lastLoggedPhase: string | undefined;

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
      // Fetch app info and upgrade phase in parallel
      const [infoResult, upgradePhase] = await Promise.all([
        userApiClient.getInfos([appId], 1),
        fetchUpgradePhase(userApiClient, appId),
      ]);

      if (infoResult.length === 0) {
        await sleep(WATCH_POLL_INTERVAL_SECONDS * 1000);
        continue;
      }

      const appInfo = infoResult[0];
      const currentStatus = appInfo.status;
      const currentIP = appInfo.ip || "";
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      // Log upgrade phase transitions
      if (upgradePhase && upgradePhase !== lastLoggedPhase) {
        const label = UPGRADE_PHASE_LABELS[upgradePhase] || upgradePhase;
        logger.info(`Phase: ${label} (${elapsed}s)`);
        lastLoggedPhase = upgradePhase;
      }

      // Log app status changes (only when phase info is unavailable, to avoid noise)
      if (!upgradePhase && currentStatus !== lastLoggedStatus) {
        logger.info(`Status: ${currentStatus} (${elapsed}s)`);
        lastLoggedStatus = currentStatus;
      }

      // Check stop condition
      if (stopCondition(currentStatus, currentIP)) {
        const totalElapsed = Math.round((Date.now() - startTime) / 1000);
        logger.info(`Upgrade completed in ${totalElapsed}s`);
        return;
      }

      // Wait before next poll
      await sleep(WATCH_POLL_INTERVAL_SECONDS * 1000);
    } catch (error: any) {
      // Re-throw errors from stopCondition (e.g., app entered Failed state)
      if (error.message?.includes("entered")) {
        throw error;
      }
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
