import { Command, Flags } from "@oclif/core";
import {
  getEnvironmentConfig,
  UserApiClient,
  isMainnet,
  prepareDeploy,
  executeDeploy,
  watchDeployment,
} from "@layr-labs/ecloud-sdk";
import { withTelemetry } from "../../../telemetry";
import { commonFlags } from "../../../flags";
import {
  getDockerfileInteractive,
  getImageReferenceInteractive,
  getOrPromptAppName,
  getEnvFileInteractive,
  getInstanceTypeInteractive,
  getLogSettingsInteractive,
  getResourceUsageMonitoringInteractive,
  getAppProfileInteractive,
  LogVisibility,
  ResourceUsageMonitoring,
  confirm,
  getPrivateKeyInteractive,
} from "../../../utils/prompts";
import { invalidateProfileCache, setLinkedAppForFolder } from "../../../utils/globalConfig";
import { getClientId } from "../../../utils/version";
import chalk from "chalk";

export default class AppDeploy extends Command {
  static description = "Deploy new app";

  static flags = {
    ...commonFlags,
    name: Flags.string({
      required: false,
      description: "Friendly name for the app",
      env: "ECLOUD_NAME",
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
      description: "Machine instance type to use e.g. g1-standard-4t, g1-standard-8t",
      env: "ECLOUD_INSTANCE_TYPE",
    }),
    "skip-profile": Flags.boolean({
      required: false,
      description: "Skip app profile setup",
      default: false,
    }),
    "resource-usage-monitoring": Flags.string({
      required: false,
      description: "Resource usage monitoring: enable or disable",
      options: ["enable", "disable"],
      env: "ECLOUD_RESOURCE_USAGE_MONITORING",
    }),
    website: Flags.string({
      required: false,
      description: "App website URL (optional)",
    }),
    description: Flags.string({
      required: false,
      description: "App description (optional)",
    }),
    "x-url": Flags.string({
      required: false,
      description: "X (Twitter) profile URL (optional)",
    }),
    image: Flags.string({
      required: false,
      description: "Path to app icon/logo image - JPG/PNG, max 4MB, square recommended (optional)",
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(AppDeploy);

      // Create CLI logger
      const logger = {
        info: (msg: string) => this.log(msg),
        warn: (msg: string) => this.warn(msg),
        error: (msg: string) => this.error(msg),
        debug: (msg: string) => flags.verbose && this.log(msg),
      };

      // Get environment config for fetching available instance types
      const environment = flags.environment || "sepolia";
      const environmentConfig = getEnvironmentConfig(environment);
      const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;

      // Get private key interactively if not provided
      const privateKey = await getPrivateKeyInteractive(flags["private-key"]);

      // 1. Get dockerfile path interactively
      const dockerfilePath = await getDockerfileInteractive(flags.dockerfile);
      const buildFromDockerfile = dockerfilePath !== "";

      // 2. Get image reference interactively (context-aware)
      const imageRef = await getImageReferenceInteractive(flags["image-ref"], buildFromDockerfile);

      // 3. Get app name interactively
      const appName = await getOrPromptAppName(flags.name, environment, imageRef);

      // 4. Get env file path interactively
      const envFilePath = await getEnvFileInteractive(flags["env-file"]);

      // 5. Get instance type interactively
      // First, fetch available instance types from backend
      const availableTypes = await fetchAvailableInstanceTypes(
        environmentConfig,
        privateKey,
        rpcUrl,
      );
      const instanceType = await getInstanceTypeInteractive(
        flags["instance-type"],
        "", // No default for new deployments
        availableTypes,
      );

      // 6. Get log visibility interactively
      const logSettings = await getLogSettingsInteractive(
        flags["log-visibility"] as LogVisibility | undefined,
      );

      // 7. Get resource usage monitoring interactively
      const resourceUsageMonitoring = await getResourceUsageMonitoringInteractive(
        flags["resource-usage-monitoring"] as ResourceUsageMonitoring | undefined,
      );

      // 8. Prepare deployment (builds image, pushes to registry, prepares batch, estimates gas)
      const logVisibility = logSettings.publicLogs
        ? "public"
        : logSettings.logRedirect
          ? "private"
          : "off";

      const { prepared, gasEstimate } = await prepareDeploy(
        {
          privateKey,
          rpcUrl,
          environment,
          dockerfilePath,
          imageRef,
          envFilePath,
          appName,
          instanceType,
          logVisibility,
          resourceUsageMonitoring,
          skipTelemetry: true,
        },
        logger,
      );

      // 9. Show gas estimate and prompt for confirmation on mainnet
      this.log(`\nEstimated transaction cost: ${chalk.cyan(gasEstimate.maxCostEth)} ETH`);

      if (isMainnet(environmentConfig)) {
        const confirmed = await confirm(`Continue with deployment?`);
        if (!confirmed) {
          this.log(`\n${chalk.gray(`Deployment cancelled`)}`);
          return;
        }
      }

      // 10. Execute the deployment
      const res = await executeDeploy(
        prepared,
        {
          maxFeePerGas: gasEstimate.maxFeePerGas,
          maxPriorityFeePerGas: gasEstimate.maxPriorityFeePerGas,
        },
        logger,
        true, // skipTelemetry
      );

      // 11. Collect app profile while deployment is in progress (optional)
      if (!flags["skip-profile"]) {
        // Check if any profile flags were provided
        const hasProfileFlags = flags.website || flags.description || flags["x-url"] || flags.image;

        let profile: {
          name: string;
          website?: string;
          description?: string;
          xURL?: string;
          imagePath?: string;
        } | null = null;

        if (hasProfileFlags) {
          // Use flags directly if any were provided
          profile = {
            name: appName,
            website: flags.website,
            description: flags.description,
            xURL: flags["x-url"],
            imagePath: flags.image,
          };
        } else {
          // Otherwise prompt interactively
          this.log(
            "\nDeployment confirmed onchain. While your instance provisions, set up a public profile:",
          );

          try {
            profile = (await getAppProfileInteractive(appName, true)) || null;
          } catch {
            // Profile collection cancelled or failed - continue without profile
            logger.debug("Profile collection skipped or cancelled");
          }
        }

        if (profile) {
          // Upload profile if provided (non-blocking - warn on failure but don't fail deployment)
          logger.info("Uploading app profile...");
          try {
            const userApiClient = new UserApiClient(
              environmentConfig,
              privateKey,
              rpcUrl,
              getClientId(),
            );
            await userApiClient.uploadAppProfile(
              res.appId as `0x${string}`,
              profile.name,
              profile.website,
              profile.description,
              profile.xURL,
              profile.imagePath,
            );
            logger.info("✓ Profile uploaded successfully");

            // Invalidate profile cache to ensure fresh data on next command
            try {
              invalidateProfileCache(environment);
            } catch (cacheErr: any) {
              logger.debug(`Failed to invalidate profile cache: ${cacheErr.message}`);
            }
          } catch (uploadErr: any) {
            logger.warn(`Failed to upload profile: ${uploadErr.message}`);
          }
        }
      }

      // 12. Watch until app is running
      const ipAddress = await watchDeployment(
        res.appId,
        privateKey,
        rpcUrl,
        environment,
        logger,
        getClientId(),
        true, // skipTelemetry - CLI already has telemetry
      );

      try {
        const cwd = process.env.INIT_CWD || process.cwd();
        setLinkedAppForFolder(environment, cwd, String(res.appId));
      } catch (err: any) {
        logger.debug(`Failed to link folder to app: ${err.message}`);
      }

      this.log(
        `\n✅ ${chalk.green(`App deployed successfully ${chalk.bold(`(id: ${res.appId}, ip: ${ipAddress})`)}`)}`,
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
