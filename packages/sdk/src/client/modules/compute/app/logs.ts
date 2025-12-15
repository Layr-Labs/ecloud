/**
 * Logs command
 *
 * View app logs with optional watch mode
 *
 * NOTE: This SDK function is non-interactive. All required parameters must be
 * provided explicitly. Use the CLI for interactive parameter collection.
 */

import { Address } from "viem";
import { Logger } from "../../../common/types";
import { defaultLogger } from "../../../common/utils";
import { UserApiClient } from "../../../common/utils/userapi";
import { getEnvironmentConfig } from "../../../common/config/environment";
import { validateAppID } from "../../../common/utils/validation";
import chalk from "chalk";

/**
 * Required logs options for SDK (non-interactive)
 */
export interface SDKLogsOptions {
  /** App ID (address) or app name - required */
  appID: string | Address;
  /** Watch logs continuously - optional */
  watch?: boolean;
  /** Environment name - optional, defaults to 'sepolia' */
  environment?: string;
  /** Private key for authenticated requests - optional */
  privateKey?: string;
  /** RPC URL - optional, uses environment default */
  rpcUrl?: string;
  /** Client ID for API requests - optional */
  clientId?: string;
}

/**
 * Legacy interface for backward compatibility
 * @deprecated Use SDKLogsOptions instead
 */
export interface LogsOptions {
  appID?: string | Address;
  watch?: boolean;
  environment?: string;
  privateKey?: string;
  rpcUrl?: string;
  clientId?: string;
}

// App status constants
const AppStatusCreated = "Created";
const AppStatusDeploying = "Deploying";
const AppStatusUpgrading = "Upgrading";
const AppStatusResuming = "Resuming";
const AppStatusStopping = "Stopping";
const AppStatusStopped = "Stopped";
const AppStatusTerminating = "Terminating";
const AppStatusTerminated = "Terminated";
const AppStatusSuspended = "Suspended";
const AppStatusFailed = "Failed";

// Watch poll interval
const WATCH_POLL_INTERVAL_SECONDS = 5;

/**
 * Format app display
 */
function formatAppDisplay(environmentName: string, appID: Address, profileName: string): string {
  if (profileName) {
    return `${profileName} (${environmentName}:${appID})`;
  }
  return `${environmentName}:${appID}`;
}

/**
 * Show countdown for watch mode
 * Shows countdown from seconds down to 0, one second at a time
 */
async function showCountdown(seconds: number, shouldStop: () => boolean): Promise<void> {
  for (let i = seconds; i >= 0; i--) {
    if (shouldStop()) {
      return;
    }
    process.stdout.write(chalk.gray(`\rRefreshing in ${i}...`));
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

/**
 * Watch logs continuously
 */
async function watchLogs(
  appID: Address,
  userApiClient: UserApiClient,
  initialLogs: string,
): Promise<void> {
  const tailSize = 65536; // 64KB

  // Track previously seen logs
  let prevLogs = initialLogs;

  // Handle graceful shutdown
  let shouldStop = false;
  const stopHandler = () => {
    shouldStop = true;
  };
  process.on("SIGINT", stopHandler);
  process.on("SIGTERM", stopHandler);

  try {
    while (!shouldStop) {
      // Show countdown
      await showCountdown(WATCH_POLL_INTERVAL_SECONDS, () => shouldStop);

      if (shouldStop) {
        break;
      }

      // Fetch fresh logs
      let newLogs: string;
      try {
        newLogs = await userApiClient.getLogs(appID);
      } catch {
        // Silently continue on error in watch mode
        continue;
      }

      // Skip if no new logs
      if (newLogs === prevLogs) {
        continue;
      }

      // Clear the countdown line
      process.stdout.write("\r\x1b[K");

      if (newLogs.startsWith(prevLogs)) {
        // Normal append - show only new content
        const newContent = newLogs.slice(prevLogs.length);
        process.stdout.write(newContent);
      } else {
        // Check if logs were truncated (old tail matches somewhere in new)
        const tail = prevLogs.slice(Math.max(0, prevLogs.length - tailSize)); // Last 64KB
        const idx = newLogs.lastIndexOf(tail);
        if (idx !== -1) {
          // Found the tail at position idx
          // Print everything after where the old logs ended
          process.stdout.write(newLogs.slice(idx + tail.length));
        } else {
          if (newLogs.length < prevLogs.length) {
            console.log("--- Logs restarted ---");
          } else {
            console.log("--- Log stream gap detected ---");
          }
          process.stdout.write(newLogs);
        }
      }
      // Reset any incomplete formatting/special chars and add blank line
      process.stdout.write("\x1b[0m");
      console.log();
      prevLogs = newLogs;
    }
  } finally {
    process.removeListener("SIGINT", stopHandler);
    process.removeListener("SIGTERM", stopHandler);
  }

  console.log("\nStopped watching");
}

/**
 * View app logs
 *
 * This function is non-interactive and requires appID to be provided explicitly.
 *
 * @param options - Required options including appID
 * @param logger - Optional logger instance
 * @throws Error if appID is missing or invalid
 */
export async function logs(
  options: SDKLogsOptions | LogsOptions,
  logger: Logger = defaultLogger,
): Promise<void> {
  console.log();

  // Validate required parameters
  if (!options.appID) {
    throw new Error("appID is required for viewing logs");
  }

  // Get environment config
  const environment = options.environment || "sepolia";
  const environmentConfig = getEnvironmentConfig(environment);

  // Get RPC URL (needed for contract queries and authentication)
  const rpcUrl = options.rpcUrl || environmentConfig.defaultRPCURL;
  if (!rpcUrl) {
    throw new Error("RPC URL is required for authenticated requests");
  }

  // Validate app ID (must be a valid address - name resolution is done by CLI)
  const appID = validateAppID(options.appID);

  // Format app display (no profile name in SDK - CLI handles that)
  const formattedApp = formatAppDisplay(environmentConfig.name, appID, "");

  // Create user API client
  const userApiClient = new UserApiClient(
    environmentConfig,
    options.privateKey,
    rpcUrl,
    options.clientId,
  );

  // Fetch logs
  let logsText: string;
  let logsError: Error | null = null;
  try {
    logsText = await userApiClient.getLogs(appID);
  } catch (err: any) {
    logsError = err;
    logsText = "";
  }

  const watchMode = options.watch || false;

  // Handle empty logs or errors
  if (logsError || logsText.trim() === "") {
    // If watch mode is enabled, enter watch loop even without initial logs
    if (watchMode) {
      logger.info("\nWaiting for logs to become available...");
      console.log();
      await watchLogs(appID, userApiClient, "");
      return;
    }

    // Not watch mode - check app status to provide helpful message and exit
    try {
      const statuses = await userApiClient.getStatuses([appID]);
      if (statuses.length > 0) {
        const status = statuses[0].status;
        switch (status) {
          case AppStatusCreated:
          case AppStatusDeploying:
            logger.info(
              `${formattedApp} is currently being provisioned. Logs will be available once deployment is complete.`,
            );
            return;
          case AppStatusUpgrading:
            logger.info(
              `${formattedApp} is currently upgrading. Logs will be available once upgrade is complete.`,
            );
            return;
          case AppStatusResuming:
            logger.info(`${formattedApp} is currently resuming. Logs will be available shortly.`);
            return;
          case AppStatusStopping:
            logger.info(`${formattedApp} is currently stopping. Logs may be limited.`);
            return;
          case AppStatusStopped:
          case AppStatusTerminating:
          case AppStatusTerminated:
          case AppStatusSuspended:
            logger.info(`${formattedApp} is ${status.toLowerCase()}. Logs are not available.`);
            return;
          case AppStatusFailed:
            logger.info(`${formattedApp} has failed. Check the app status for more information.`);
            return;
        }
      }
    } catch {
      // If we can't get status either, continue to error handling
    }

    // If we can't get status either, return the original logs error
    if (logsError) {
      throw new Error(
        `Failed to get logs, you can watch for logs by calling this command with the --watch flag (or --w): ${logsError.message}`,
      );
    }
    throw new Error(
      "Failed to get logs, you can watch for logs by calling this command with the --watch flag (or --w): empty logs",
    );
  }

  // Print initial logs
  console.log(logsText);

  // Check if watch mode is enabled
  if (!watchMode) {
    return;
  }

  // Watch mode: continuously fetch and display new logs
  await watchLogs(appID, userApiClient, logsText);
}
