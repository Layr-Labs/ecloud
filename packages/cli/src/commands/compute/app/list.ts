import { Command, Flags } from "@oclif/core";
import {
  getEnvironmentConfig,
  getAllAppsByDeveloper,
  getAppLatestReleaseBlockNumbers,
  getBlockTimestamps,
  UserApiClient,
} from "@layr-labs/ecloud-sdk";
import { commonFlags, validateCommonFlags } from "../../../flags";
import { privateKeyToAccount } from "viem/accounts";
import { Address } from "viem";
import { getAppName } from "../../../utils/appNames";
import chalk from "chalk";

// Contract app status constants
const ContractAppStatusStarted = 1;
const ContractAppStatusStopped = 2;
const ContractAppStatusTerminated = 3;
const ContractAppStatusSuspended = 4;

/**
 * Map contract status enum to display string
 */
function getContractStatusString(status: number): string {
  switch (status) {
    case ContractAppStatusStarted:
      return "Started";
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
 * Format app status with color
 */
function formatStatus(status: string): string {
  switch (status.toLowerCase()) {
    case "running":
    case "started":
      return chalk.green(status);
    case "stopped":
      return chalk.yellow(status);
    case "terminated":
      return chalk.red(status);
    case "suspended":
      return chalk.red(status);
    case "deploying":
    case "upgrading":
    case "resuming":
    case "stopping":
      return chalk.cyan(status);
    case "failed":
      return chalk.red(status);
    default:
      return chalk.gray(status);
  }
}

export default class AppList extends Command {
  static description = "List all deployed apps";

  static flags = {
    ...commonFlags,
    all: Flags.boolean({
      description: "Show all apps including terminated ones",
      char: "a",
      default: false,
    }),
  };

  async run() {
    const { flags } = await this.parse(AppList);

    // Validate flags and prompt for missing values
    const validatedFlags = await validateCommonFlags(flags);

    // Get environment config
    const environment = validatedFlags.environment || "sepolia";
    const environmentConfig = getEnvironmentConfig(environment);
    const rpcUrl = validatedFlags["rpc-url"] || environmentConfig.defaultRPCURL;
    const privateKey = validatedFlags["private-key"]!;

    // Get developer address from private key
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const developerAddr = account.address;

    if (flags.verbose) {
      this.log(`Fetching apps for developer: ${developerAddr}`);
    }

    // List apps from contract
    const result = await getAllAppsByDeveloper(rpcUrl, environmentConfig, developerAddr);

    if (result.apps.length === 0) {
      this.log(`\nNo apps found for developer ${developerAddr}`);
      return;
    }

    // Filter out terminated apps unless --all flag is used
    const filteredApps: Address[] = [];
    const filteredConfigs: { status: number }[] = [];

    for (let i = 0; i < result.apps.length; i++) {
      const config = result.appConfigs[i];
      if (!flags.all && config.status === ContractAppStatusTerminated) {
        continue;
      }
      filteredApps.push(result.apps[i]);
      filteredConfigs.push(config);
    }

    if (filteredApps.length === 0) {
      if (flags.all) {
        this.log(`\nNo apps found for developer ${developerAddr}`);
      } else {
        this.log(
          `\nNo active apps found for developer ${developerAddr} (use --all to show terminated apps)`,
        );
      }
      return;
    }

    // Create UserAPI client to get additional info
    const userApiClient = new UserApiClient(environmentConfig, privateKey, rpcUrl);

    // Fetch all data in parallel
    const [appInfos, releaseBlockNumbers] = await Promise.all([
      userApiClient.getInfos(filteredApps, 1).catch((err) => {
        if (flags.verbose) {
          this.warn(`Could not fetch app info from UserAPI: ${err}`);
        }
        return [];
      }),
      getAppLatestReleaseBlockNumbers(rpcUrl, environmentConfig, filteredApps).catch((err) => {
        if (flags.verbose) {
          this.warn(`Could not fetch release block numbers: ${err}`);
        }
        return new Map<Address, number>();
      }),
    ]);

    // Get unique block numbers and fetch their timestamps
    const blockNumbers = [...releaseBlockNumbers.values()].filter((n) => n > 0);
    const blockTimestamps =
      blockNumbers.length > 0
        ? await getBlockTimestamps(rpcUrl, environmentConfig, blockNumbers).catch((err) => {
            if (flags.verbose) {
              this.warn(`Could not fetch block timestamps: ${err}`);
            }
            return new Map<number, number>();
          })
        : new Map<number, number>();

    // Print header
    console.log();
    this.log(chalk.bold(`Apps for ${developerAddr} (${environment}):`));
    console.log();

    // Print each app
    for (let i = 0; i < filteredApps.length; i++) {
      const appAddr = filteredApps[i];
      const config = filteredConfigs[i];

      // Get local app name from registry
      const localName = getAppName(environment, appAddr);

      // Get API info if available
      const apiInfo = appInfos.find(
        (info) => info.address && String(info.address).toLowerCase() === appAddr.toLowerCase(),
      );

      // Determine status (prefer API status over contract status)
      const status = apiInfo?.status || getContractStatusString(config.status);

      // Get release time from block timestamp
      const releaseBlockNumber = releaseBlockNumbers.get(appAddr);
      const releaseTimestamp = releaseBlockNumber
        ? blockTimestamps.get(releaseBlockNumber)
        : undefined;
      const releaseTimeDisplay = releaseTimestamp
        ? chalk.gray(new Date(releaseTimestamp * 1000).toISOString().replace("T", " ").slice(0, 19))
        : chalk.gray("-");

      // Get derived addresses
      const evmAddr = apiInfo?.evmAddresses?.[0];
      const solanaAddr = apiInfo?.solanaAddresses?.[0];
      const evmDisplay = evmAddr
        ? chalk.gray(`${evmAddr.address} (path: ${evmAddr.derivationPath})`)
        : chalk.gray("-");
      const solanaDisplay = solanaAddr
        ? chalk.gray(`${solanaAddr.address} (path: ${solanaAddr.derivationPath})`)
        : chalk.gray("-");

      // Build display
      const nameDisplay = localName ? chalk.cyan(localName) : chalk.gray("(unnamed)");
      const appIdDisplay = chalk.gray(appAddr);
      const statusDisplay = formatStatus(status);
      const ipDisplay =
        apiInfo?.ip && apiInfo.ip !== "No IP assigned"
          ? chalk.white(apiInfo.ip)
          : chalk.gray("No IP assigned");
      const machineDisplay =
        apiInfo?.machineType && apiInfo.machineType !== "No instance assigned"
          ? chalk.gray(apiInfo.machineType)
          : chalk.gray("-");

      // Print app info
      this.log(`  ${nameDisplay}`);
      this.log(`    ID:             ${appIdDisplay}`);
      this.log(`    Release Time:   ${releaseTimeDisplay}`);
      this.log(`    Status:         ${statusDisplay}`);
      this.log(`    Instance:       ${machineDisplay}`);
      this.log(`    IP:             ${ipDisplay}`);
      this.log(`    EVM Address:    ${evmDisplay}`);
      this.log(`    Solana Address: ${solanaDisplay}`);

      // Add separator between apps
      if (i < filteredApps.length - 1) {
        this.log(
          chalk.gray("  ────────────────────────────────────────────────────────────────────"),
        );
      }
    }

    console.log();
    this.log(chalk.gray(`Total: ${filteredApps.length} app(s)`));
  }
}
