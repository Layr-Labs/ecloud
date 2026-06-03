import { Command, Flags } from "@oclif/core";
import {
  getEnvironmentConfig,
  getAllAppsByDeveloper,
  getAppLatestReleaseBlockNumbers,
  getBlockTimestamps,
  UserApiClient,
  getPendingTimelockOps,
  type PendingTimelockOp,
} from "@layr-labs/ecloud-sdk";
import { commonFlags, validateCommonFlags } from "../../../flags";
import { privateKeyToAccount } from "viem/accounts";
import { Address, Hex } from "viem";
import { getAppName } from "../../../utils/appNames";
import {
  ContractAppStatusTerminated,
  getContractStatusString,
  getStatusSortPriority,
} from "../../../utils/prompts";
import { getAppInfosChunked } from "../../../utils/appResolver";
import { formatAppDisplay, printAppDisplay, formatCountdown } from "../../../utils/format";
import { createViemClients } from "../../../utils/viemClients";
import { getDashboardUrl } from "../../../utils/dashboard";
import { getClientId } from "../../../utils/version";
import { getIdentities, getActiveIdentityAddress, formatIdentity } from "../../../utils/globalConfig";
import chalk from "chalk";
import { withTelemetry } from "../../../telemetry";

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
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(AppList);

      // Validate flags — private key is required for API authentication
      const validatedFlags = await validateCommonFlags(flags);

      const environment = validatedFlags.environment;
      const environmentConfig = getEnvironmentConfig(environment);
      const rpcUrl = validatedFlags["rpc-url"] || environmentConfig.defaultRPCURL;
      const privateKey = validatedFlags["private-key"]!;

      const account = privateKeyToAccount(privateKey as Hex);
      const eoaAddress = account.address;

      const { publicClient, walletClient } = createViemClients({
        privateKey,
        rpcUrl,
        environment,
      });

      const userApiClient = new UserApiClient(environmentConfig, walletClient, publicClient, {
        clientId: getClientId(),
      });

      // Collect addresses to query — EOA + all identity addresses
      const identities = getIdentities();
      const addressesToQuery: { address: Address; label: string }[] = [];

      if (identities.length > 0) {
        for (const id of identities) {
          addressesToQuery.push({
            address: id.address as Address,
            label: formatIdentity(id),
          });
        }
      } else {
        // No identities configured — query just the EOA
        addressesToQuery.push({
          address: eoaAddress,
          label: `${eoaAddress.slice(0, 6)}...${eoaAddress.slice(-4)}  (EOA)`,
        });
      }

      const activeAddress = getActiveIdentityAddress(environment);
      let totalApps = 0;

      // Fetch pending Timelock ops for any Timelock identities
      const pendingOpsMap = new Map<string, PendingTimelockOp[]>(); // app address → ops
      const timelockIdentities = identities.filter((id) => id.type === "timelock" && id.environment === environment);
      for (const tlId of timelockIdentities) {
        try {
          const ops = await getPendingTimelockOps(publicClient, tlId.address as Address);
          for (const op of ops) {
            // Extract app address from description (format: "functionName(0x...)")
            const match = op.description.match(/\((0x[0-9a-fA-F]{40})\)/);
            if (match) {
              const appAddr = match[1].toLowerCase();
              const existing = pendingOpsMap.get(appAddr) ?? [];
              existing.push(op);
              pendingOpsMap.set(appAddr, existing);
            }
          }
        } catch {
          // skip if Timelock doesn't support getPendingOperations
        }
      }

      console.log();

      for (const { address, label } of addressesToQuery) {
        // Declare the identity we're querying under so the platform evaluates
        // permissions against this address rather than the signing EOA.
        // EOA queries keep the header empty — server falls back to signer.
        userApiClient.setIdentities(
          address.toLowerCase() === eoaAddress.toLowerCase() ? [] : [address],
        );

        // Query apps owned by this address from blockchain
        const result = await getAllAppsByDeveloper(publicClient, environmentConfig, address);

        // Filter out terminated unless --all
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

        if (filteredApps.length === 0) continue;

        totalApps += filteredApps.length;

        // Print identity header
        const isActive = address.toLowerCase() === activeAddress?.toLowerCase();
        const activeMarker = isActive ? chalk.green(" ← active") : "";
        this.log(chalk.bold(`${label}${activeMarker}`));
        console.log();

        // Fetch app info from UserAPI (authenticated with EOA signature — backend
        // resolves Safe/Timelock ownership) and release data from blockchain
        const [appInfos, releaseBlockNumbers] = await Promise.all([
          getAppInfosChunked(userApiClient, filteredApps, 1).catch((err) => {
            if (flags.verbose) {
              this.warn(`Could not fetch app info from UserAPI: ${err}`);
            }
            return [];
          }),
          getAppLatestReleaseBlockNumbers(publicClient, environmentConfig, filteredApps).catch(
            (err) => {
              if (flags.verbose) {
                this.warn(`Could not fetch release block numbers: ${err}`);
              }
              return new Map<Address, number>();
            },
          ) as Promise<Map<Address, number>>,
        ]);

        // Get unique block numbers and fetch their timestamps
        const blockNumbers = Array.from(releaseBlockNumbers.values()).filter((n) => n > 0);
        const blockTimestamps =
          blockNumbers.length > 0
            ? await getBlockTimestamps(publicClient, blockNumbers).catch((err) => {
                if (flags.verbose) {
                  this.warn(`Could not fetch block timestamps: ${err}`);
                }
                return new Map<number, number>();
              })
            : new Map<number, number>();

        // Build and sort app items
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

        appItems.sort((a, b) => {
          const aPriority = getStatusSortPriority(a.status);
          const bPriority = getStatusSortPriority(b.status);
          if (aPriority !== bPriority) return aPriority - bPriority;
          return (b.releaseTimestamp || 0) - (a.releaseTimestamp || 0);
        });

        // Print each app
        for (let i = 0; i < appItems.length; i++) {
          const { apiInfo, appName, status, releaseTimestamp } = appItems[i];

          if (!apiInfo) continue;

          const display = formatAppDisplay({ appInfo: apiInfo, appName, status, releaseTimestamp });

          this.log(`  ${display.name}`);
          printAppDisplay(display, this.log.bind(this), "    ", {
            singleAddress: true,
            showProfile: false,
          });

          const dashboardUrl = getDashboardUrl(environment, appItems[i].appAddr);
          this.log(`    Dashboard:      ${chalk.blue.underline(dashboardUrl)}`);

          // Show pending Timelock ops for this app
          const appOps = pendingOpsMap.get(appItems[i].appAddr.toLowerCase());
          if (appOps && appOps.length > 0) {
            for (const op of appOps) {
              const now = BigInt(Math.floor(Date.now() / 1000));
              const status = op.ready
                ? chalk.green("ready to execute")
                : `executable in ${formatCountdown(op.executableAt - now)}`;
              this.log(`    ⏳ ${op.description}  [${status}]`);
            }
          }

          if (i < appItems.length - 1) {
            this.log(chalk.gray("  ──────────────────────────────────────────────────────────────"));
          }
        }

        console.log();
      }

      if (totalApps === 0) {
        if (flags.all) {
          this.log("No apps found.");
        } else {
          this.log("No active apps found (use --all to show terminated apps).");
        }
      } else {
        this.log(chalk.gray(`Total: ${totalApps} app(s) across ${addressesToQuery.length} identity(ies)`));
      }
    });
  }
}
