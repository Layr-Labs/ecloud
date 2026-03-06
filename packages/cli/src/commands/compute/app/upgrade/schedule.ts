import { Command, Args, Flags } from "@oclif/core";
import { getEnvironmentConfig, isMainnet } from "@layr-labs/ecloud-sdk";
import { withTelemetry } from "../../../../telemetry";
import { commonFlags } from "../../../../flags";
import { createComputeClient } from "../../../../client";
import { createViemClients } from "../../../../utils/viemClients";
import {
  getDockerfileInteractive,
  getImageReferenceInteractive,
  getEnvFileInteractive,
  getInstanceTypeInteractive,
  getLogSettingsInteractive,
  getResourceUsageMonitoringInteractive,
  getOrPromptAppID,
  LogVisibility,
  ResourceUsageMonitoring,
  confirm,
} from "../../../../utils/prompts";
import chalk from "chalk";
import { UserApiClient } from "@layr-labs/ecloud-sdk";
import { getClientId } from "../../../../utils/version";
import { scheduleUpgrade } from "@layr-labs/ecloud-sdk";

/**
 * Parse a human-readable duration string into seconds.
 * Supported: 30s, 5m, 2h, 1d
 */
function parseDurationToSeconds(input: string): bigint {
  const match = input.match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d)?$/i);
  if (!match) {
    throw new Error(`Invalid duration "${input}". Use format: 30s, 5m, 2h, 1d`);
  }
  const value = parseFloat(match[1]);
  const unit = (match[2] || "s").toLowerCase();
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return BigInt(Math.ceil(value * multipliers[unit]));
}

export default class AppUpgradeSchedule extends Command {
  static description = "Schedule an upgrade for a timelocked app. The upgrade becomes executable after the specified delay.";

  static args = {
    "app-id": Args.string({
      description: "App ID or name to upgrade",
      required: false,
    }),
  };

  static flags = {
    ...commonFlags,
    after: Flags.string({
      required: true,
      description: "Delay before upgrade can execute (e.g. 30s, 5m, 2h, 1d)",
      env: "ECLOUD_UPGRADE_DELAY",
    }),
    dockerfile: Flags.string({
      required: false,
      description: "Path to Dockerfile",
      env: "ECLOUD_DOCKERFILE_PATH",
    }),
    "image-ref": Flags.string({
      required: false,
      description: "Image reference pointing to registry",
      env: "ECLOUD_IMAGE_REF",
    }),
    "env-file": Flags.string({
      required: false,
      description: 'Environment file to use (default: ".env")',
      default: ".env",
      env: "ECLOUD_ENVFILE_PATH",
    }),
    "log-visibility": Flags.string({
      required: false,
      description: "Log visibility setting: public, private, or off",
      options: ["public", "private", "off"],
      env: "ECLOUD_LOG_VISIBILITY",
    }),
    "instance-type": Flags.string({
      required: false,
      description: "Machine instance type",
      env: "ECLOUD_INSTANCE_TYPE",
    }),
    "resource-usage-monitoring": Flags.string({
      required: false,
      description: "Resource usage monitoring: enable or disable",
      options: ["enable", "disable"],
      env: "ECLOUD_RESOURCE_USAGE_MONITORING",
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(AppUpgradeSchedule);
      const compute = await createComputeClient(flags);

      const environment = flags.environment;
      const environmentConfig = getEnvironmentConfig(environment);
      const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;
      const privateKey = flags["private-key"]!;

      // Parse delay
      let delaySeconds: bigint;
      try {
        delaySeconds = parseDurationToSeconds(flags.after);
      } catch (e: any) {
        this.error(e.message);
      }

      // Resolve app ID
      const appID = await getOrPromptAppID({
        appID: args["app-id"],
        environment,
        privateKey,
        rpcUrl,
        action: "schedule upgrade",
      });

      // Verify timelocked mode
      const timelocked = await compute.app.isTimelocked(appID);
      if (!timelocked) {
        this.error(
          "This app is not timelocked. Use 'ecloud compute app upgrade' for direct upgrades, or transfer ownership to a Timelock first.",
        );
      }

      // Collect build inputs
      const dockerfilePath = await getDockerfileInteractive(flags.dockerfile);
      const buildFromDockerfile = dockerfilePath !== "";
      const imageRef = await getImageReferenceInteractive(flags["image-ref"], buildFromDockerfile);
      const envFilePath = await getEnvFileInteractive(flags["env-file"]);

      // Instance type
      const { publicClient, walletClient } = createViemClients({ privateKey, rpcUrl, environment });
      let currentInstanceType = "";
      try {
        const userApiClient = new UserApiClient(environmentConfig, walletClient, publicClient, { clientId: getClientId() });
        const infos = await userApiClient.getInfos([appID], 1);
        if (infos.length > 0) currentInstanceType = infos[0].machineType || "";
      } catch { /* best-effort */ }

      const availableTypes = await fetchAvailableInstanceTypes(environmentConfig, walletClient, publicClient);
      const instanceType = await getInstanceTypeInteractive(flags["instance-type"], currentInstanceType, availableTypes);

      const logSettings = await getLogSettingsInteractive(flags["log-visibility"] as LogVisibility | undefined);
      const resourceUsageMonitoring = await getResourceUsageMonitoringInteractive(
        flags["resource-usage-monitoring"] as ResourceUsageMonitoring | undefined,
      );
      const logVisibility = logSettings.publicLogs ? "public" : logSettings.logRedirect ? "private" : "off";

      const readyAt = Math.floor(Date.now() / 1000) + Number(delaySeconds);
      const readyDate = new Date(readyAt * 1000).toLocaleString();

      this.log(`\nApp:         ${chalk.bold(appID)}`);
      this.log(`Delay:       ${chalk.bold(flags.after)} (executable after ${chalk.bold(readyDate)})`);
      this.log(`Image:       ${chalk.bold(imageRef || dockerfilePath)}`);

      if (isMainnet(environmentConfig)) {
        const confirmed = await confirm("Schedule this upgrade?");
        if (!confirmed) {
          this.log(`\n${chalk.gray("Upgrade scheduling cancelled")}`);
          return;
        }
      }

      const res = await scheduleUpgrade(
        {
          appId: appID,
          walletClient,
          publicClient,
          environment,
          dockerfilePath,
          imageRef,
          envFilePath,
          instanceType,
          logVisibility: logVisibility as LogVisibility,
          resourceUsageMonitoring: resourceUsageMonitoring as ResourceUsageMonitoring,
          delaySeconds,
          skipTelemetry: true,
        },
      );

      this.log(
        `\n✅ ${chalk.green(`Upgrade scheduled (tx: ${res.txHash})`)}`,
      );
      this.log(chalk.cyan(`\nExecutable after: ${chalk.bold(readyDate)}`));
      this.log(chalk.cyan(`Run to execute:   ecloud compute app upgrade execute --app=${appID}`));
    });
  }
}

async function fetchAvailableInstanceTypes(environmentConfig: any, walletClient: any, publicClient: any) {
  try {
    const userApiClient = new UserApiClient(environmentConfig, walletClient, publicClient, { clientId: getClientId() });
    const skuList = await userApiClient.getSKUs();
    if (skuList.skus.length > 0) return skuList.skus;
  } catch {}
  return [{ sku: "g1-standard-4t", description: "4 vCPUs, 16 GB memory, TDX" }];
}
