import { Command, Args, Flags } from "@oclif/core";
import { getEnvironmentConfig, UserApiClient } from "@layr-labs/ecloud-sdk";
import { createAppClient } from "../../../client";
import { commonFlags } from "../../../flags";
import {
  getDockerfileInteractive,
  getImageReferenceInteractive,
  getEnvFileInteractive,
  getInstanceTypeInteractive,
  getLogSettingsInteractive,
  getOrPromptAppID,
  confirm,
  LogVisibility,
} from "../../../utils/prompts";
import chalk from "chalk";
import { Address } from "viem";

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
      description:
        "Machine instance type to use e.g. g1-standard-4t, g1-standard-8t",
      env: "ECLOUD_INSTANCE_TYPE",
    }),
  };

  async run() {
    const { args, flags } = await this.parse(AppUpgrade);
    const app = await createAppClient(flags);

    // Get environment config
    const environment = flags.environment || "sepolia";
    const environmentConfig = getEnvironmentConfig(environment);
    const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;

    // 1. Get app ID interactively if not provided
    const appID = await getOrPromptAppID({
      appID: args["app-id"],
      environment,
      privateKey: flags["private-key"],
      rpcUrl,
      action: "upgrade",
    });

    // 2. Get dockerfile path interactively
    const dockerfilePath = await getDockerfileInteractive(flags.dockerfile);
    const buildFromDockerfile = dockerfilePath !== "";

    // 3. Get image reference interactively (context-aware)
    const imageRef = await getImageReferenceInteractive(
      flags["image-ref"],
      buildFromDockerfile
    );

    // 4. Get env file path interactively
    const envFilePath = await getEnvFileInteractive(flags["env-file"]);

    // 5. Get current instance type (best-effort, used as default)
    let currentInstanceType = "";
    try {
      const userApiClient = new UserApiClient(
        environmentConfig,
        flags["private-key"],
        rpcUrl
      );
      const infos = await userApiClient.getInfos([appID], 1, { 
        info: () => {}, warn: () => {}, error: () => {}, debug: () => {} 
      });
      if (infos.length > 0) {
        currentInstanceType = infos[0].machineType || "";
      }
    } catch {
      // Ignore errors - will use first available as default
    }

    // 6. Get instance type interactively
    const availableTypes = await fetchAvailableInstanceTypes(
      environmentConfig,
      flags["private-key"],
      rpcUrl
    );
    const instanceType = await getInstanceTypeInteractive(
      flags["instance-type"],
      currentInstanceType,
      availableTypes
    );

    // 7. Get log visibility interactively
    const logSettings = await getLogSettingsInteractive(
      flags["log-visibility"] as LogVisibility | undefined
    );

    // 8. Upgrade with all gathered parameters
    // Note: onConfirm is available after SDK rebuild
    const res = await app.upgrade(appID as Address, {
      dockerfile: dockerfilePath || undefined,
      envFile: envFilePath || undefined,
      imageRef: imageRef || undefined,
      logVisibility: logSettings.publicLogs
        ? "public"
        : logSettings.logRedirect
          ? "private"
          : "off",
      instanceType,
      onConfirm: async (prompt: string) => {
        return confirm(prompt);
      },
    } as any);

    if (!res.tx) {
      this.log(`\n${chalk.gray(`Upgrade failed`)}`);
    } else {
      this.log(
        `\n✅ ${chalk.green(`App upgraded successfully ${chalk.bold(`(id: ${res.appID}, image: ${res.imageRef})`)}`)}`
      );
    }
  }
}

/**
 * Fetch available instance types from backend
 */
async function fetchAvailableInstanceTypes(
  environmentConfig: any,
  privateKey?: string,
  rpcUrl?: string
): Promise<Array<{ sku: string; description: string }>> {
  try {
    const userApiClient = new UserApiClient(
      environmentConfig,
      privateKey,
      rpcUrl
    );

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
