import { Command, Flags } from "@oclif/core";
import {
  getEnvironmentConfig,
  getAllAppsByDeveloper,
  getAppLatestReleaseBlockNumbers,
  getBlockTimestamps,
  UserApiClient,
  getPrivateKeyWithSource,
  getAddressFromPrivateKey,
} from "@layr-labs/ecloud-sdk";
import { commonFlags } from "../../../flags";
import { Address, Hex } from "viem";
import { getAppName } from "../../../utils/appNames";
import {
  ContractAppStatusTerminated,
  getContractStatusString,
  getStatusSortPriority,
} from "../../../utils/prompts";
import { getAppInfosChunked } from "../../../utils/appResolver";
import { formatAppDisplay, printAppDisplay } from "../../../utils/format";
import { createPublicClientOnly, createViemClients } from "../../../utils/viemClients";
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

      const environment = flags.environment as string;
      const environmentConfig = getEnvironmentConfig(environment);
      const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;

      // Collect addresses to query — from identities if available, else from signing key
      const identities = getIdentities();
      let addressesToQuery: { address: Address; label: string }[] = [];

      if (identities.length > 0) {
        for (const id of identities) {
          addressesToQuery.push({
            address: id.address as Address,
            label: formatIdentity(id),
          });
        }
      } else {
        // Fallback: derive address from signing key
        const keyResult = await getPrivateKeyWithSource({ privateKey: flags["private-key"] });
        if (!keyResult) {
          this.error("No signing key found. Run 'ecloud auth generate' or 'ecloud auth login' first.");
        }
        const address = getAddressFromPrivateKey(keyResult.key);
        addressesToQuery.push({
          address: address as Address,
          label: `${address.slice(0, 6)}...${address.slice(-4)}  (EOA)`,
        });
      }

      // Create clients — use publicClient only for reads, walletClient only if we have a key
      const keyResult = await getPrivateKeyWithSource({ privateKey: flags["private-key"] });
      let publicClient: any;
      let walletClient: any;

      if (keyResult) {
        const clients = createViemClients({
          privateKey: keyResult.key,
          rpcUrl,
          environment,
        });
        publicClient = clients.publicClient;
        walletClient = clients.walletClient;
      } else {
        publicClient = createPublicClientOnly({ environment, rpcUrl });
      }

      const activeAddress = getActiveIdentityAddress(environment);
      let totalApps = 0;

      console.log();

      for (const { address, label } of addressesToQuery) {
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

        // Create UserAPI client if we have a wallet
        let userApiClient: UserApiClient | null = null;
        if (walletClient) {
          userApiClient = new UserApiClient(environmentConfig, walletClient, publicClient, {
            clientId: getClientId(),
          });
        }

        // Fetch app info and release data
        const [appInfos, releaseBlockNumbers] = await Promise.all([
          userApiClient
            ? getAppInfosChunked(userApiClient, filteredApps, 1).catch(() => [])
            : Promise.resolve([]),
          getAppLatestReleaseBlockNumbers(publicClient, environmentConfig, filteredApps).catch(
            () => new Map<Address, number>(),
          ) as Promise<Map<Address, number>>,
        ]);

        const blockNumbers = Array.from(releaseBlockNumbers.values()).filter((n) => n > 0);
        const blockTimestamps =
          blockNumbers.length > 0
            ? await getBlockTimestamps(publicClient, blockNumbers).catch(
                () => new Map<number, number>(),
              )
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
