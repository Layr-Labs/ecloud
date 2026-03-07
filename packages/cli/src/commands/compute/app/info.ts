// [DEMO STUB] Real implementation: taras/gov branch. Set ECLOUD_REAL_MODE=true to bypass.
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
import { getClientId } from "../../../utils/version";
import { getDashboardUrl } from "../../../utils/dashboard";
import { createViemClients } from "../../../utils/viemClients";
import { Address, type PublicClient } from "viem";
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

    if (process.env.ECLOUD_REAL_MODE !== "true") {
      await demoInfo(args["app-id"], this.log.bind(this));
      return;
    }

    // Validate flags and prompt for missing values
    const validatedFlags = await validateCommonFlags(flags);

    // Get validated values from flags
    const environment = validatedFlags.environment;
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

    // Create viem clients and UserAPI client
    const { publicClient, walletClient } = createViemClients({
      privateKey,
      rpcUrl,
      environment,
    });
    const userApiClient = new UserApiClient(environmentConfig, walletClient, publicClient, {
      clientId: getClientId(),
    });

    if (flags.watch) {
      await this.watchMode(
        appID,
        userApiClient,
        publicClient,
        environmentConfig,
        flags["address-count"],
      );
    } else {
      await this.displayAppInfo(
        appID,
        userApiClient,
        publicClient,
        environmentConfig,
        flags["address-count"],
      );
    }
  }

  private async displayAppInfo(
    appID: Address,
    userApiClient: UserApiClient,
    publicClient: PublicClient,
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
      getAppLatestReleaseBlockNumbers(publicClient, environmentConfig, [appID]).catch((err) => {
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
      const blockTimestamps = await getBlockTimestamps(publicClient, [releaseBlockNumber]).catch(
        (err) => {
          this.debug(`Could not fetch block timestamps: ${err}`);
          return new Map<number, number>();
        },
      );
      releaseTimestamp = blockTimestamps.get(releaseBlockNumber);
    }

    // Check verifiability of deployed image
    let verifiabilityStatus: string | undefined;
    try {
      const appResponse = await userApiClient.getApp(appID);
      const latestRelease = appResponse.releases?.[0];
      if (latestRelease?.build?.provenanceSignature) {
        verifiabilityStatus = chalk.green("Verifiable ✓");
      } else {
        verifiabilityStatus = chalk.yellow(
          "(dev image, not built verifiably, we strongly recommend verifiable builds for production)",
        );
      }
    } catch (err) {
      // Verifiability check is best-effort - log at debug level for troubleshooting
      this.debug(`Could not determine verifiability status: ${err}`);
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

    // Show verifiability status
    if (verifiabilityStatus) {
      this.log(`  Build:          ${verifiabilityStatus}`);
    }

    // Show dashboard link
    const dashboardUrl = getDashboardUrl(environmentConfig.name, appID);
    this.log(`  Dashboard:      ${chalk.blue.underline(dashboardUrl)}`);

    console.log();
  }

  private async watchMode(
    appID: Address,
    userApiClient: UserApiClient,
    publicClient: PublicClient,
    environmentConfig: ReturnType<typeof getEnvironmentConfig>,
    addressCount: number,
  ) {
    const REFRESH_INTERVAL_SECONDS = 5;

    // Initial display
    await this.displayAppInfo(
      appID,
      userApiClient,
      publicClient,
      environmentConfig,
      addressCount,
      true,
    );

    while (true) {
      await showCountdown(REFRESH_INTERVAL_SECONDS);

      // Refresh the display
      await this.displayAppInfo(
        appID,
        userApiClient,
        publicClient,
        environmentConfig,
        addressCount,
        true,
      );
    }
  }
}

async function demoInfo(appIdArg: string | undefined, log: (msg: string) => void): Promise<void> {
  const { getDemoState, DEMO_TEAM, isTimelockOverSafe } = await import("../../../utils/demoState");
  const { identity, app } = getDemoState();

  if (!app) {
    log(chalk.yellow("\nNo app deployed yet. Run 'ecloud compute app deploy' first."));
    log("");
    return;
  }

  const appId = appIdArg || app.appId;
  const appShort = appId.slice(0, 6) + "..." + appId.slice(-4);

  const owner = identity;
  const ownerDisplay = owner
    ? owner.type === "timelock"
      ? `${owner.address.slice(0, 6)}...${owner.address.slice(-4)} (${owner.label}${owner.detail ? ", " + owner.detail : ""})`
      : `${owner.address.slice(0, 6)}...${owner.address.slice(-4)} (${owner.label})`
    : chalk.gray("(unknown)");

  const statusColor = app.status === "STARTED" ? chalk.green : app.status === "STOPPED" ? chalk.yellow : chalk.red;
  const upgradeTime = app.lastUpgradeAt
    ? new Date(app.lastUpgradeAt * 1000).toLocaleString()
    : new Date(app.deployedAt * 1000).toLocaleString();

  log("");
  log(`App: ${chalk.cyan.bold(app.name)}  ${chalk.gray(`(${appShort})`)}`);
  log(`  Owner:          ${chalk.bold(ownerDisplay)}`);
  log(`  Status:         ${statusColor(app.status)}`);
  log(`  Image:          ${app.image}`);
  log(`  Last upgrade:   ${upgradeTime}`);
  log(`  Instance type:  ${app.instanceType}`);
  log(`  IP Address:     ${app.ipAddress}`);

  if (owner && (owner.type === "safe" || isTimelockOverSafe(owner))) {
    log("");
    log("  Team Roles:");

    const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));
    const roleLabel = (role: string) => chalk.bold(pad(role + ":", 12));

    for (const [role, members] of Object.entries(DEMO_TEAM)) {
      members.forEach((m, i) => {
        const addr = m.address.slice(0, 6) + "..." + m.address.slice(-4);
        const desc = `${addr} (${m.label})`;
        if (i === 0) {
          log(`    ${roleLabel(role)} ${desc}`);
        } else {
          log(`    ${" ".repeat(12)} ${desc}`);
        }
      });
    }
  }

  log("");
  log(`  Dashboard: ${chalk.blue.underline(`https://app.eigencloud.xyz/apps/${appId}`)}`);
  log("");
}

async function showCountdown(seconds: number): Promise<void> {
  for (let i = seconds; i >= 0; i--) {
    process.stdout.write(chalk.gray(`\rRefreshing in ${i}...`));
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
