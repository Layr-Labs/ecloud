/**
 * Info command
 *
 * Show detailed app instance info with optional watch mode
 */

import { Address, createPublicClient, http, Hex } from "viem";
import { sepolia, mainnet } from "viem/chains";
import { Logger } from "../../common/types";
import { defaultLogger } from "../../common/utils";
import { UserApiClient } from "../../common/utils/userapi";
import { getEnvironmentConfig } from "../../common/config/environment";
import { getAppName } from "../../common/registry/appNames";
import { getOrPromptAppID } from "../../common/utils/prompts";
import AppControllerABI from "../../common/abis/AppController.json";
import { AppProfileResponse } from "../../common/types";
import chalk from "chalk";

export interface InfoOptions {
  appID?: string | Address;
  watch?: boolean;
  environment?: string;
  privateKey?: string;
  rpcUrl?: string;
  addressCount?: number;
}

// Contract app status constants
const ContractAppStatusNone = 0;
const ContractAppStatusStarted = 1;
const ContractAppStatusStopped = 2;
const ContractAppStatusTerminated = 3;
const ContractAppStatusSuspended = 4;

// App status constants
const AppStatusRunning = "Running";
const AppStatusStopped = "Stopped";
const AppStatusTerminated = "Terminated";
const AppStatusSuspended = "Suspended";
const AppStatusExited = "Exited";

// Watch poll interval
const WATCH_POLL_INTERVAL_SECONDS = 5;

/**
 * Contract status to string
 */
function contractStatusToString(status: number): string {
  switch (status) {
    case ContractAppStatusStarted:
      return "Running";
    case ContractAppStatusStopped:
      return "Stopped";
    case ContractAppStatusTerminated:
      return "Terminated";
    case ContractAppStatusSuspended:
      return "Suspended";
    default:
      return "Unknown";
  }
}

/**
 * Get display status by comparing contract and API status
 */
function getDisplayStatus(
  contractStatus: number,
  apiStatus: string,
  statusOverride?: string,
): string {
  // If override provided, use it
  if (statusOverride) {
    return statusOverride;
  }

  // If no API status, return contract status
  if (!apiStatus) {
    return contractStatusToString(contractStatus);
  }

  // Special API statuses take precedence
  if (apiStatus.toLowerCase() === AppStatusExited.toLowerCase()) {
    return AppStatusExited;
  }

  const contractStatusStr = contractStatusToString(contractStatus);

  // If states match, return API status
  if (contractStatusStr.toLowerCase() === apiStatus.toLowerCase()) {
    return apiStatus;
  }

  // States differ - check if we're in a transition
  const transitions: Record<string, string> = {
    Running: "Starting",
    Stopped: "Stopping",
    Terminated: "Terminating",
  };

  if (transitions[contractStatusStr]) {
    return transitions[contractStatusStr];
  }

  // Default to API status
  return apiStatus;
}

/**
 * Format app display
 */
function formatAppDisplay(
  environmentName: string,
  appID: Address,
  profileName: string,
): string {
  if (profileName) {
    return `${profileName} (${environmentName}:${appID})`;
  }
  return `${environmentName}:${appID}`;
}

/**
 * Show countdown for watch mode
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
 * Full app info type
 */
type FullAppInfo = {
  address: Address;
  status: string;
  ip: string;
  machineType: string;
  evmAddresses: Array<{
    address: Address;
    derivationPath: string;
  }>;
  solanaAddresses: Array<{
    address: string;
    derivationPath: string;
  }>;
  profile?: AppProfileResponse;
};

async function getFullAppInfo(
  userApiClient: UserApiClient,
  appID: Address,
  addressCount: number,
  logger: Logger,
): Promise<FullAppInfo | null> {
  try {
    const infos = await userApiClient.getFullInfos([appID], addressCount, logger);
    if (infos.length === 0) {
      return null;
    }
    return infos[0] as FullAppInfo;
  } catch (err: any) {
    logger.debug(`Failed to get full app info: ${err.message}`);
    return null;
  }
}

/**
 * Print EVM addresses
 */
function printEVMAddresses(
  logger: Logger,
  addresses: Array<{ address: Address; derivationPath: string }>,
): void {
  if (addresses.length === 0) {
    return;
  }

  if (addresses.length === 1) {
    const addr = addresses[0];
    logger.info(`EVM Address: ${addr.address} (path: ${addr.derivationPath})`);
  } else {
    logger.info("EVM Addresses:");
    addresses.forEach((addr, i) => {
      logger.info(`  [${i}] ${addr.address} (path: ${addr.derivationPath})`);
    });
  }
}

/**
 * Print Solana addresses
 */
function printSolanaAddresses(
  logger: Logger,
  addresses: Array<{ address: string; derivationPath: string }>,
): void {
  if (addresses.length === 0) {
    return;
  }

  if (addresses.length === 1) {
    const addr = addresses[0];
    logger.info(`Solana Address: ${addr.address} (path: ${addr.derivationPath})`);
  } else {
    logger.info("Solana Addresses:");
    addresses.forEach((addr, i) => {
      logger.info(`  [${i}] ${addr.address} (path: ${addr.derivationPath})`);
    });
  }
}

/**
 * Print app info
 */
async function printAppInfo(
  appID: Address,
  contractStatus: number,
  releaseBlockNumber: number,
  apiInfo: FullAppInfo | null,
  environmentName: string,
  logger: Logger,
  rpcUrl: string,
  environmentConfig: any,
  statusOverride?: string,
): Promise<void> {
  // Get block timestamp if release block number is available
  let latestReleaseTime: Date | null = null;
  if (releaseBlockNumber > 0) {
    try {
      const chain =
        environmentConfig.chainID === 11155111n
          ? sepolia
          : environmentConfig.chainID === 1n
            ? mainnet
            : sepolia;

      const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl),
      });

      const block = await publicClient.getBlock({
        blockNumber: BigInt(releaseBlockNumber),
      });
      latestReleaseTime = new Date(Number(block.timestamp) * 1000);
    } catch (err: any) {
      logger.debug(`Failed to get block timestamp: ${err.message}`);
    }
  }

  console.log();

  // Show app name - prioritise profile name, fall back to local registry
  const profileName = apiInfo?.profile?.name || getAppName(environmentName, appID);
  if (profileName) {
    logger.info(`App Name: ${profileName}`);
  }

  logger.info(`App ID: ${appID}`);

  if (latestReleaseTime) {
    logger.info(`Latest Release Time: ${latestReleaseTime.toLocaleString()}`);
  }

  // Compare contract and API status to show transition states when they differ
  const apiStatus = apiInfo?.status || "";
  const status = getDisplayStatus(contractStatus, apiStatus, statusOverride);
  logger.info(`Status: ${status}`);

  if (apiInfo) {
    logger.info(`Instance: ${apiInfo.machineType || "N/A"}`);
    logger.info(`IP: ${apiInfo.ip || "No IP assigned"}`);
  }

  // Display app profile if available
  if (apiInfo?.profile) {
    if (apiInfo.profile.website) {
      logger.info(`Website: ${apiInfo.profile.website}`);
    }
    if (apiInfo.profile.description) {
      logger.info(`Description: ${apiInfo.profile.description}`);
    }
    if (apiInfo.profile.xURL) {
      logger.info(`X URL: ${apiInfo.profile.xURL}`);
    }
    if (apiInfo.profile.imageURL) {
      logger.info(`Image URL: ${apiInfo.profile.imageURL}`);
    }
  }

  // Display addresses if available
  if (apiInfo?.evmAddresses && apiInfo.evmAddresses.length > 0) {
    printEVMAddresses(logger, apiInfo.evmAddresses);
  }
  if (apiInfo?.solanaAddresses && apiInfo.solanaAddresses.length > 0) {
    printSolanaAddresses(logger, apiInfo.solanaAddresses);
  }

  console.log();
}

/**
 * Get and print app info
 */
async function getAndPrintAppInfo(
  appID: Address,
  environment: string,
  privateKey: string,
  rpcUrl: string,
  addressCount: number,
  logger: Logger,
  statusOverride?: string,
): Promise<void> {
  const environmentConfig = getEnvironmentConfig(environment);

  // Map chainID to viem Chain
  const chain =
    environmentConfig.chainID === 11155111n
      ? sepolia
      : environmentConfig.chainID === 1n
        ? mainnet
        : sepolia;

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  // Get app status and release block number from contract
  const [contractStatus, releaseBlockNumber] = await Promise.all([
    publicClient.readContract({
      address: environmentConfig.appControllerAddress as Address,
      abi: AppControllerABI,
      functionName: "getAppStatus",
      args: [appID],
    }) as Promise<number>,
    publicClient.readContract({
      address: environmentConfig.appControllerAddress as Address,
      abi: AppControllerABI,
      functionName: "getAppLatestReleaseBlockNumber",
      args: [appID],
    }) as Promise<number>,
  ]);

  // Get app info from UserAPI
  const userApiClient = new UserApiClient(environmentConfig, privateKey, rpcUrl);
  const apiInfo = await getFullAppInfo(userApiClient, appID, addressCount, logger);

  if (!apiInfo) {
    throw new Error(`No info found for app ${appID}`);
  }

  // Print app info
  await printAppInfo(
    appID,
    contractStatus,
    releaseBlockNumber,
    apiInfo,
    environment,
    logger,
    rpcUrl,
    environmentConfig,
    statusOverride,
  );
}

/**
 * Watch app info loop
 */
async function watchAppInfoLoop(
  appID: Address,
  environment: string,
  privateKey: string,
  rpcUrl: string,
  addressCount: number,
  logger: Logger,
  statusOverride?: string,
): Promise<void> {
  const environmentConfig = getEnvironmentConfig(environment);
  const userApiClient = new UserApiClient(environmentConfig, privateKey, rpcUrl);

  // Display initial info
  await getAndPrintAppInfo(
    appID,
    environment,
    privateKey,
    rpcUrl,
    addressCount,
    logger,
    statusOverride,
  );

  // Track previous state for comparison
  let prevStatus: string | undefined;
  let prevIP: string | undefined;
  let prevMachineType: string | undefined;

  // Fetch initial state
  const initialInfo = await getFullAppInfo(userApiClient, appID, addressCount, logger);
  if (initialInfo) {
    prevStatus = initialInfo.status;
    prevIP = initialInfo.ip;
    prevMachineType = initialInfo.machineType;
  }

  // Handle graceful shutdown
  let shouldStop = false;
  const stopHandler = () => {
    shouldStop = true;
  };
  process.on("SIGINT", stopHandler);
  process.on("SIGTERM", stopHandler);

  try {
    // Main watch loop
    while (!shouldStop) {
      // Show countdown
      await showCountdown(WATCH_POLL_INTERVAL_SECONDS, () => shouldStop);

      if (shouldStop) {
        break;
      }

      // Fetch fresh info
      const currentInfo = await getFullAppInfo(userApiClient, appID, addressCount, logger);
      if (!currentInfo) {
        continue;
      }

      const currentStatus = currentInfo.status;
      const currentIP = currentInfo.ip;
      const currentMachineType = currentInfo.machineType;

      // Print status changes
      if (currentStatus !== prevStatus && prevStatus !== undefined) {
        process.stdout.write("\r\x1b[K"); // Clear countdown line
        logger.info(`Status changed: ${prevStatus} → ${currentStatus}`);
        prevStatus = currentStatus;
      }

      // Print IP assignment (only when transitioning from no IP to having an IP)
      if (currentIP !== prevIP && currentIP) {
        if (!prevIP || prevIP === "No IP assigned") {
          if (currentStatus === prevStatus) {
            // Only clear if we didn't already clear for status change
            process.stdout.write("\r\x1b[K");
          }
          logger.info(`IP assigned: ${currentIP}`);
        }
        prevIP = currentIP;
      }

      // Track instance type changes
      if (currentMachineType !== prevMachineType && prevMachineType !== undefined) {
        const isSkuUpdate =
          prevMachineType &&
          prevMachineType !== "No instance assigned" &&
          currentMachineType &&
          currentMachineType !== "No instance assigned";

        if (isSkuUpdate) {
          if (currentStatus === prevStatus && currentIP === prevIP) {
            process.stdout.write("\r\x1b[K");
          }
          logger.info(`Instance type changed: ${prevMachineType} → ${currentMachineType}`);
        }
        prevMachineType = currentMachineType;
      }
    }
  } finally {
    process.removeListener("SIGINT", stopHandler);
    process.removeListener("SIGTERM", stopHandler);
  }

  console.log("\nStopped watching");
}

/**
 * Show app info
 */
export async function info(
  options: InfoOptions,
  logger: Logger = defaultLogger,
): Promise<void> {
  // Get environment config
  const environment = options.environment || "sepolia";
  const environmentConfig = getEnvironmentConfig(environment);

  // Get RPC URL (needed for contract queries and authentication)
  const rpcUrl = options.rpcUrl || environmentConfig.defaultRPCURL;
  if (!rpcUrl) {
    throw new Error("RPC URL is required for authenticated requests");
  }

  if (!options.privateKey) {
    throw new Error("Private key is required");
  }

  // Get app ID
  const appID = await getOrPromptAppID({
    appID: options.appID,
    environment,
    privateKey: options.privateKey,
    rpcUrl,
    action: "view",
  });

  let addressCount = options.addressCount || 1;
  if (addressCount <= 0) {
    addressCount = 1;
  }

  // Check if watch mode is enabled
  if (!options.watch) {
    await getAndPrintAppInfo(
      appID,
      environment,
      options.privateKey,
      rpcUrl,
      addressCount,
      logger,
    );
    return;
  }

  // Watch mode: continuously fetch and display info
  await watchAppInfoLoop(
    appID,
    environment,
    options.privateKey,
    rpcUrl,
    addressCount,
    logger,
  );
}

