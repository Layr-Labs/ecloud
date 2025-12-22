import { Command, Args, Flags } from "@oclif/core";
import { getEnvironmentConfig, isMainnet, UserApiClient } from "@layr-labs/ecloud-sdk";
import { withTelemetry } from "../../../telemetry";
import { commonFlags } from "../../../flags";
import { createComputeClient } from "../../../client";
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
} from "../../../utils/prompts";
import { getClientId } from "../../../utils/version";
import chalk from "chalk";

export default class AppUpgrade extends Command {
  static description = "Upgrade existing deployment";

  static args = {
    "app-id": Args.string({
      description: "App ID or name to upgrade",
      required: false,
    }),
  };

  static flags = {
    ...commonFlags,
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
      description: "Machine instance type to use e.g. g1-standard-4t, g1-standard-8t",
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
      const { args, flags } = await this.parse(AppUpgrade);
      const compute = await createComputeClient(flags);

      // Get validated values from flags (mutated by createComputeClient)
      const environment = flags.environment;
      const environmentConfig = getEnvironmentConfig(environment);
      const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;
      const privateKey = flags["private-key"]!;

      // 1. Get app ID interactively if not provided
      const appID = await getOrPromptAppID({
        appID: args["app-id"],
        environment,
        privateKey,
        rpcUrl,
        action: "upgrade",
      });

      // 2. Get dockerfile path interactively
      const dockerfilePath = await getDockerfileInteractive(flags.dockerfile);
      const buildFromDockerfile = dockerfilePath !== "";

      // 3. Get image reference interactively (context-aware)
      const imageRef = await getImageReferenceInteractive(flags["image-ref"], buildFromDockerfile);

      // 4. Get env file path interactively
      const envFilePath = await getEnvFileInteractive(flags["env-file"]);

      // 5. Get current instance type (best-effort, used as default)
      let currentInstanceType = "";
      try {
        const userApiClient = new UserApiClient(
          environmentConfig,
          privateKey,
          rpcUrl,
          getClientId(),
        );
        const infos = await userApiClient.getInfos([appID], 1);
        if (infos.length > 0) {
          currentInstanceType = infos[0].machineType || "";
        }
      } catch {
        // Ignore errors - will use first available as default
      }

      // 6. Get instance type interactively
      const availableTypes = await fetchAvailableInstanceTypes(
        environmentConfig,
        privateKey,
        rpcUrl,
      );
      const instanceType = await getInstanceTypeInteractive(
        flags["instance-type"],
        currentInstanceType,
        availableTypes,
      );

      // 7. Get log visibility interactively
      const logSettings = await getLogSettingsInteractive(
        flags["log-visibility"] as LogVisibility | undefined,
      );

      // 8. Get resource usage monitoring interactively
      const resourceUsageMonitoring = await getResourceUsageMonitoringInteractive(
        flags["resource-usage-monitoring"] as ResourceUsageMonitoring | undefined,
      );

      // 9. Prepare upgrade (builds image, pushes to registry, prepares batch, estimates gas)
      const logVisibility = logSettings.publicLogs
        ? "public"
        : logSettings.logRedirect
          ? "private"
          : "off";

      const { prepared, gasEstimate } = await compute.app.prepareUpgrade(appID, {
        dockerfile: dockerfilePath,
        imageRef,
        envFile: envFilePath,
        instanceType,
        logVisibility,
        resourceUsageMonitoring,
      });

      // 10. Show gas estimate and prompt for confirmation on mainnet
      this.log(`\nEstimated transaction cost: ${chalk.cyan(gasEstimate.maxCostEth)} ETH`);

      if (isMainnet(environmentConfig)) {
        const confirmed = await confirm(`Continue with upgrade?`);
        if (!confirmed) {
          this.log(`\n${chalk.gray(`Upgrade cancelled`)}`);
          return;
        }
      }

      // 11. Execute the upgrade
      const res = await compute.app.executeUpgrade(prepared, {
        maxFeePerGas: gasEstimate.maxFeePerGas,
        maxPriorityFeePerGas: gasEstimate.maxPriorityFeePerGas,
      });

      // 12. Watch until upgrade completes
      await compute.app.watchUpgrade(res.appId as `0x${string}`);

      this.log(
        `\n✅ ${chalk.green(`App upgraded successfully ${chalk.bold(`(id: ${res.appId}, image: ${res.imageRef})`)}`)}`,
      );
    });
  }
}

/**
 * Fetch available instance types from backend
 */
async function fetchAvailableInstanceTypes(
  environmentConfig: any,
  privateKey?: string,
  rpcUrl?: string,
): Promise<Array<{ sku: string; description: string }>> {
  try {
    const userApiClient = new UserApiClient(environmentConfig, privateKey, rpcUrl, getClientId());

    const skuList = await userApiClient.getSKUs();
    if (skuList.skus.length === 0) {
      throw new Error("No instance types available from server");
    }

    return skuList.skus;
  } catch (err: any) {
    console.warn(`Failed to fetch instance types: ${err.message}`);
    // Return a default fallback
    return [{ sku: "g1-standard-4t", description: "Standard 4-thread instance" }];
  }
}
