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
import { executeGovernedUpgrade } from "@layr-labs/ecloud-sdk";
import { setLinkedAppForDirectory } from "../../../../utils/globalConfig";
import { getDashboardUrl } from "../../../../utils/dashboard";

export default class AppUpgradeExecute extends Command {
  static description = "Execute a previously scheduled upgrade for a timelocked app once the delay has elapsed";

  static args = {
    "app-id": Args.string({
      description: "App ID or name",
      required: false,
    }),
  };

  static flags = {
    ...commonFlags,
    dockerfile: Flags.string({
      required: false,
      description: "Path to Dockerfile (must match what was used in schedule)",
      env: "ECLOUD_DOCKERFILE_PATH",
    }),
    "image-ref": Flags.string({
      required: false,
      description: "Image reference (must match what was used in schedule)",
      env: "ECLOUD_IMAGE_REF",
    }),
    "env-file": Flags.string({
      required: false,
      description: 'Environment file (must match what was used in schedule)',
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
      const { args, flags } = await this.parse(AppUpgradeExecute);
      const compute = await createComputeClient(flags);

      const environment = flags.environment;
      const environmentConfig = getEnvironmentConfig(environment);
      const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;
      const privateKey = flags["private-key"]!;

      // Resolve app ID
      const appID = await getOrPromptAppID({
        appID: args["app-id"],
        environment,
        privateKey,
        rpcUrl,
        action: "execute upgrade",
      });

      // Verify timelocked mode
      const timelocked = await compute.app.isTimelocked(appID);
      if (!timelocked) {
        this.error("This app is not timelocked. Use 'ecloud compute app upgrade' for direct upgrades.");
      }

      // Check scheduled upgrade status
      const pending = await compute.app.getPendingUpgrade(appID);
      if (pending.readyAt === 0n) {
        this.error("No upgrade is scheduled for this app. Run 'ecloud compute app upgrade schedule' first.");
      }

      const now = BigInt(Math.floor(Date.now() / 1000));
      if (now < pending.readyAt) {
        const remaining = pending.readyAt - now;
        const readyDate = new Date(Number(pending.readyAt) * 1000).toLocaleString();
        this.error(`Upgrade is not ready yet. Executable after ${chalk.bold(readyDate)} (${remaining}s remaining).`);
      }

      this.log(chalk.cyan(`\nScheduled upgrade is ready. Proceeding with execution...`));
      this.log(chalk.yellow("Note: build inputs must exactly match what was used in 'upgrade schedule'."));

      // Collect the same build inputs used during scheduling
      const dockerfilePath = await getDockerfileInteractive(flags.dockerfile);
      const buildFromDockerfile = dockerfilePath !== "";
      const imageRef = await getImageReferenceInteractive(flags["image-ref"], buildFromDockerfile);
      const envFilePath = await getEnvFileInteractive(flags["env-file"]);

      const { publicClient, walletClient } = createViemClients({ privateKey, rpcUrl, environment });
      let currentInstanceType = "";
      try {
        const userApiClient = new UserApiClient(environmentConfig, walletClient, publicClient, { clientId: getClientId() });
        const infos = await userApiClient.getInfos([appID], 1);
        if (infos.length > 0) currentInstanceType = infos[0].machineType || "";
      } catch {}

      const availableTypes = await fetchAvailableInstanceTypes(environmentConfig, walletClient, publicClient);
      const instanceType = await getInstanceTypeInteractive(flags["instance-type"], currentInstanceType, availableTypes);

      const logSettings = await getLogSettingsInteractive(flags["log-visibility"] as LogVisibility | undefined);
      const resourceUsageMonitoring = await getResourceUsageMonitoringInteractive(
        flags["resource-usage-monitoring"] as ResourceUsageMonitoring | undefined,
      );
      const logVisibility = logSettings.publicLogs ? "public" : logSettings.logRedirect ? "private" : "off";

      if (isMainnet(environmentConfig)) {
        const confirmed = await confirm("Execute the scheduled upgrade?");
        if (!confirmed) {
          this.log(`\n${chalk.gray("Execution cancelled")}`);
          return;
        }
      }

      const res = await executeGovernedUpgrade(
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
          skipTelemetry: true,
        },
      );

      try {
        const cwd = process.env.INIT_CWD || process.cwd();
        setLinkedAppForDirectory(environment, cwd, res.appId);
      } catch {}

      this.log(
        `\n✅ ${chalk.green(`App upgraded successfully ${chalk.bold(`(id: ${res.appId}, image: ${res.imageRef})`)}`)}`,
      );

      const dashboardUrl = getDashboardUrl(environment, res.appId);
      this.log(`\n${chalk.gray("View your app:")} ${chalk.blue.underline(dashboardUrl)}`);
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
