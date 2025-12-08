import { Command, Flags } from "@oclif/core";
import {
  getEnvironmentConfig,
  UserApiClient,
  isMainnet,
  prepareDeploy,
  executeDeploy,
} from "@layr-labs/ecloud-sdk";
import { commonFlags } from "../../../flags";
import {
  getDockerfileInteractive,
  getImageReferenceInteractive,
  getOrPromptAppName,
  getEnvFileInteractive,
  getInstanceTypeInteractive,
  getLogSettingsInteractive,
  getAppProfileInteractive,
  LogVisibility,
  confirm,
  getPrivateKeyInteractive,
} from "../../../utils/prompts";
import { setAppName } from "../../../utils/appNames";
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
  };

  async run() {
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
    const privateKey = flags["private-key"] || (await getPrivateKeyInteractive());

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
    const availableTypes = await fetchAvailableInstanceTypes(environmentConfig, privateKey, rpcUrl);
    const instanceType = await getInstanceTypeInteractive(
      flags["instance-type"],
      "", // No default for new deployments
      availableTypes,
    );

    // 6. Get log visibility interactively
    const logSettings = await getLogSettingsInteractive(
      flags["log-visibility"] as LogVisibility | undefined,
    );

    // 7. Optionally collect app profile
    let profile = undefined;
    if (!flags["skip-profile"]) {
      try {
        // Extract suggested name from image reference
        const suggestedName = appName;
        this.log("\nSet up a public profile for your app (you can skip this):");
        profile = await getAppProfileInteractive(suggestedName, true);
      } catch {
        // Profile collection cancelled or failed - continue without profile
        profile = undefined;
      }
    }

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
        profile,
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
    );

    // 11. Save the app name mapping locally
    try {
      await setAppName(environment, res.appId, appName);
      logger.info(`App saved with name: ${appName}`);
    } catch (err: any) {
      logger.warn(`Failed to save app name: ${err.message}`);
    }

    this.log(
      `\n✅ ${chalk.green(`App deployed successfully ${chalk.bold(`(id: ${res.appId}, ip: ${res.ipAddress})`)}`)}`,
    );
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
    const userApiClient = new UserApiClient(environmentConfig, privateKey, rpcUrl);

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
