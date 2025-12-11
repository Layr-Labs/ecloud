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
import {
  ContractAppStatusTerminated,
  getContractStatusString,
  getStatusSortPriority,
} from "../../../utils/prompts";
import { getAppInfosChunked } from "../../../utils/appResolver";
import { formatAppDisplay, printAppDisplay } from "../../../utils/format";
import { getClientId } from "../../../utils/version";
import chalk from "chalk";

export default class AppList extends Command {
  static description = "List all deployed apps";

  static flags = {
    ...commonFlags,
    all: Flags.boolean({
      description: "Show all apps including terminated ones",
      char: "a",
      default: false,
    }),
    "address-count": Flags.integer({
      description: "Number of addresses to fetch",
      default: 1,
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
    const userApiClient = new UserApiClient(environmentConfig, privateKey, rpcUrl, getClientId());

    // Fetch all data in parallel
    const addressCount = flags["address-count"];
    const [appInfos, releaseBlockNumbers] = await Promise.all([
      getAppInfosChunked(userApiClient, filteredApps, addressCount).catch((err) => {
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
      }) as Promise<Map<Address, number>>,
    ]);

    // Get unique block numbers and fetch their timestamps
    const blockNumbers = Array.from(releaseBlockNumbers.values()).filter((n) => n > 0);
    const blockTimestamps =
      blockNumbers.length > 0
        ? await getBlockTimestamps(rpcUrl, environmentConfig, blockNumbers).catch((err) => {
            if (flags.verbose) {
              this.warn(`Could not fetch block timestamps: ${err}`);
            }
            return new Map<number, number>();
          })
        : new Map<number, number>();

    // Build app items with all data for sorting
    interface AppDisplayItem {
      appAddr: Address;
      apiInfo: (typeof appInfos)[0] | undefined;
      appName: string;
      status: string;
      releaseTimestamp: number | undefined;
    }

    const appItems: AppDisplayItem[] = [];
    for (let i = 0; i < filteredApps.length; i++) {
      const appAddr = filteredApps[i];
      const config = filteredConfigs[i];

      const apiInfo = appInfos.find(
        (info) => info.address && String(info.address).toLowerCase() === appAddr.toLowerCase(),
      );

      const profileName = apiInfo?.profile?.name;
      const localName = getAppName(environment, appAddr);
      const appName = profileName || localName;

      const status = apiInfo?.status || getContractStatusString(config.status);

      const releaseBlockNumber = releaseBlockNumbers.get(appAddr);
      const releaseTimestamp = releaseBlockNumber
        ? blockTimestamps.get(releaseBlockNumber)
        : undefined;

      appItems.push({ appAddr, apiInfo, appName, status, releaseTimestamp });
    }

    // Sort apps: Running first, then by status priority, then by release time (newest first)
    appItems.sort((a, b) => {
      const aPriority = getStatusSortPriority(a.status);
      const bPriority = getStatusSortPriority(b.status);

      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }

      // Within same status, sort by release time (newest first)
      const aTime = a.releaseTimestamp || 0;
      const bTime = b.releaseTimestamp || 0;
      return bTime - aTime;
    });

    // Print header
    console.log();
    this.log(chalk.bold(`Apps for ${developerAddr} (${environment}):`));
    console.log();

    // Print each app
    for (let i = 0; i < appItems.length; i++) {
      const { apiInfo, appName, status, releaseTimestamp } = appItems[i];

      // Skip if no API info (shouldn't happen, but be safe)
      if (!apiInfo) {
        continue;
      }

      // Format app display using shared utility
      const display = formatAppDisplay({
        appInfo: apiInfo,
        appName,
        status,
        releaseTimestamp,
      });

      // Print app name header
      this.log(`  ${display.name}`);

      // Print app details using shared utility
      printAppDisplay(display, this.log.bind(this), "    ", {
        singleAddress: addressCount === 1,
        showProfile: false,
      });

      // Add separator between apps
      if (i < appItems.length - 1) {
        this.log(
          chalk.gray("  ────────────────────────────────────────────────────────────────────"),
        );
      }
    }

    console.log();
    this.log(chalk.gray(`Total: ${appItems.length} app(s)`));
  }
}
