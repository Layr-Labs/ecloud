/**
 * Contract watcher
 *
 * Watches app status until it reaches Running state using UserAPI
 */

import { Address } from "viem";
import { EnvironmentConfig, Logger } from "../types";
import { UserApiClient } from "../utils/userapi";

export interface WatchUntilRunningOptions {
  privateKey: string;
  rpcUrl: string;
  environmentConfig: EnvironmentConfig;
  appID: Address;
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
  const { environmentConfig, appID, privateKey } = options;

  // Create UserAPI client
  const userApiClient = new UserApiClient(environmentConfig, privateKey);

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
  while (true) {
    try {
      // Fetch app info
      const info = await userApiClient.getInfos([appID], 1, logger);
      if (info.length === 0) {
        await sleep(WATCH_POLL_INTERVAL_SECONDS * 1000);
        continue;
      }

      const appInfo = info[0];
      const currentStatus = appInfo.status;
      const currentIP = appInfo.ip || "";

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

export interface WatchUntilUpgradeCompleteOptions {
  privateKey: string;
  rpcUrl: string;
  environmentConfig: EnvironmentConfig;
  appID: Address;
}

const APP_STATUS_UPGRADING = "Upgrading";
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
  const { environmentConfig, appID, privateKey } = options;

  // Create UserAPI client
  const userApiClient = new UserApiClient(environmentConfig, privateKey);

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
        logger.info(`To start the app, run: eigenx app start ${appID}`);
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
      logger.info(`To start the app, run: eigenx app start ${appID}`);
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
      const info = await userApiClient.getInfos([appID], 1, logger);
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
