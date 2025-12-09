import { Command, Args, Flags } from "@oclif/core";
import {
  getEnvironmentConfig,
  getAppLatestReleaseBlockNumbers,
  getBlockTimestamps,
  UserApiClient,
} from "@layr-labs/ecloud-sdk";
import { commonFlags, validateCommonFlags } from "../../../flags";
import { getOrPromptAppID } from "../../../utils/prompts";
import { formatAppDisplay, printAppDisplay } from "../../../utils/format";
import { Address } from "viem";
import chalk from "chalk";

export default class AppInfo extends Command {
  static description = "Show detailed information for a specific app";

  static args = {
    "app-id": Args.string({
      description: "App ID or name",
      required: false,
    }),
  };

  static flags = {
    ...commonFlags,
    watch: Flags.boolean({
      description: "Watch mode: refresh every 5 seconds",
      char: "w",
      default: false,
    }),
    "address-count": Flags.integer({
      description: "Number of derived addresses to show",
      default: 1,
    }),
  };

  async run() {
    const { args, flags } = await this.parse(AppInfo);

    // Validate flags and prompt for missing values
    const validatedFlags = await validateCommonFlags(flags);

    // Get environment config
    const environment = validatedFlags.environment || "sepolia";
    const environmentConfig = getEnvironmentConfig(environment);
    const rpcUrl = validatedFlags["rpc-url"] || environmentConfig.defaultRPCURL;
    const privateKey = validatedFlags["private-key"]!;

    // Get app ID interactively if not provided
    const appID = await getOrPromptAppID({
      appID: args["app-id"],
      environment,
      privateKey,
      rpcUrl,
      action: "view info for",
    });

    // Create UserAPI client
    const userApiClient = new UserApiClient(environmentConfig, privateKey, rpcUrl);

    if (flags.watch) {
      await this.watchMode(appID, userApiClient, rpcUrl, environmentConfig, flags["address-count"]);
    } else {
      await this.displayAppInfo(
        appID,
        userApiClient,
        rpcUrl,
        environmentConfig,
        flags["address-count"],
      );
    }
  }

  private async displayAppInfo(
    appID: Address,
    userApiClient: UserApiClient,
    rpcUrl: string,
    environmentConfig: ReturnType<typeof getEnvironmentConfig>,
    addressCount: number,
    clearScreen = false,
  ) {
    // Fetch all data in parallel
    const [appInfos, releaseBlockNumbers] = await Promise.all([
      userApiClient.getInfos([appID], addressCount).catch((err) => {
        this.warn(`Could not fetch app info: ${err}`);
        return [];
      }),
      getAppLatestReleaseBlockNumbers(rpcUrl, environmentConfig, [appID]).catch((err) => {
        this.warn(`Could not fetch release block numbers: ${err}`);
        return new Map<Address, number>();
      }) as Promise<Map<Address, number>>,
    ]);

    const appInfo = appInfos[0];
    if (!appInfo) {
      this.error(`App ${appID} not found`);
    }

    // Get release timestamp
    const releaseBlockNumber = releaseBlockNumbers.get(appID);
    let releaseTimestamp: number | undefined;
    if (releaseBlockNumber && releaseBlockNumber > 0) {
      const blockTimestamps = await getBlockTimestamps(rpcUrl, environmentConfig, [
        releaseBlockNumber,
      ]).catch(() => new Map<number, number>());
      releaseTimestamp = blockTimestamps.get(releaseBlockNumber);
    }

    // Clear screen if in watch mode
    if (clearScreen) {
      console.clear();
    }

    // Format app display using shared utility
    const display = formatAppDisplay({
      appInfo,
      releaseTimestamp,
      showProfileDetails: true,
    });

    // Display app info
    console.log();
    const appName = appInfo.profile?.name;
    const nameDisplay = appName ? chalk.cyan.bold(appName) : chalk.gray("(unnamed)");
    this.log(`App: ${nameDisplay}`);

    // Print using shared utility
    printAppDisplay(display, this.log.bind(this), "  ", {
      singleAddress: false,
      showProfile: true,
    });

    console.log();
  }

  private async watchMode(
    appID: Address,
    userApiClient: UserApiClient,
    rpcUrl: string,
    environmentConfig: ReturnType<typeof getEnvironmentConfig>,
    addressCount: number,
  ) {
    const REFRESH_INTERVAL = 5000; // 5 seconds

    // Initial display
    await this.displayAppInfo(appID, userApiClient, rpcUrl, environmentConfig, addressCount, true);
    this.log(chalk.gray("Watching for changes... (press Ctrl+C to exit)"));

    while (true) {
      // Wait for the refresh interval with countdown display
      await this.waitWithCountdown(REFRESH_INTERVAL);

      // Refresh the display
      await this.displayAppInfo(
        appID,
        userApiClient,
        rpcUrl,
        environmentConfig,
        addressCount,
        true,
      );
      this.log(chalk.gray("Watching for changes... (press Ctrl+C to exit)"));
    }
  }

  private async waitWithCountdown(ms: number): Promise<void> {
    const seconds = Math.ceil(ms / 1000);
    for (let i = seconds; i > 0; i--) {
      process.stdout.write(chalk.gray(`\rRefreshing in ${i}s... `));
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    process.stdout.write("\r" + " ".repeat(30) + "\r"); // Clear the countdown line
  }
}
