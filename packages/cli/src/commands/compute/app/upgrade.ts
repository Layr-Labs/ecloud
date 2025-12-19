import { Command, Args, Flags } from "@oclif/core";
import {
  getEnvironmentConfig,
  UserApiClient,
  isMainnet,
  prepareUpgrade,
  prepareUpgradeFromVerifiableBuild,
  executeUpgrade,
  watchUpgrade,
} from "@layr-labs/ecloud-sdk";
import { withTelemetry } from "../../../telemetry";
import { commonFlags } from "../../../flags";
import { createBuildClient } from "../../../client";
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
  getPrivateKeyInteractive,
  promptUseVerifiableBuild,
  promptVerifiableSourceType,
  promptVerifiableGitSourceInputs,
  promptVerifiablePrebuiltImageRef,
} from "../../../utils/prompts";
import { getClientId } from "../../../utils/version";
import chalk from "chalk";
import { formatVerifiableBuildSummary } from "../../../utils/build";
import { assertCommitSha40, runVerifiableBuildAndVerify } from "../../../utils/verifiableBuild";
import {
  assertEigencloudContainersImageRef,
  resolveDockerHubImageDigest,
} from "../../../utils/dockerhub";
import { isTlsEnabledFromEnvFile } from "../../../utils/tls";
import type { SubmitBuildRequest } from "@layr-labs/ecloud-sdk";

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

    // Verifiable build flags
    verifiable: Flags.boolean({
      description:
        "Enable verifiable build mode (either build from git source via --repo/--commit, or upgrade to a prebuilt verifiable image via --image-ref)",
      default: false,
    }),
    repo: Flags.string({
      description: "Git repository URL (required with --verifiable git source mode)",
      env: "ECLOUD_BUILD_REPO",
    }),
    commit: Flags.string({
      description: "Git commit SHA (required with --verifiable git source mode)",
      env: "ECLOUD_BUILD_COMMIT",
    }),
    "build-dockerfile": Flags.string({
      description: "Dockerfile path for verifiable build (git source mode)",
      default: "Dockerfile",
      env: "ECLOUD_BUILD_DOCKERFILE",
    }),
    "build-context": Flags.string({
      description: "Build context path for verifiable build (git source mode)",
      default: ".",
      env: "ECLOUD_BUILD_CONTEXT",
    }),
    "build-dependencies": Flags.string({
      description: "Dependency digests for verifiable build (git source mode) (sha256:...)",
      multiple: true,
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(AppUpgrade);

      // Create CLI logger
      const logger = {
        info: (msg: string) => this.log(msg),
        warn: (msg: string) => this.warn(msg),
        error: (msg: string) => this.error(msg),
        debug: (msg: string) => flags.verbose && this.log(msg),
      };

      // Get environment config
      const environment = flags.environment || "sepolia";
      const environmentConfig = getEnvironmentConfig(environment);
      const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;

      // Get private key interactively if not provided
      const privateKey = await getPrivateKeyInteractive(flags["private-key"]);

      // 1. Get app ID interactively if not provided
      const appID = await getOrPromptAppID({
        appID: args["app-id"],
        environment,
        privateKey,
        rpcUrl,
        action: "upgrade",
      });

      type VerifiableMode = "none" | "git" | "prebuilt";
      let buildClient: Awaited<ReturnType<typeof createBuildClient>> | undefined;
      const getBuildClient = async () => {
        if (buildClient) return buildClient;
        buildClient = await createBuildClient({
          ...flags,
          "private-key": privateKey,
        });
        return buildClient;
      };

      // Optional: verifiable build mode (git source build OR prebuilt verifiable image)
      let verifiableImageUrl: string | undefined;
      let verifiableImageDigest: string | undefined;
      let verifiableMode: VerifiableMode = "none";
      let envFilePath: string | undefined;

      if (flags.verifiable) {
        if (flags.repo || flags.commit) {
          verifiableMode = "git";
          if (!flags.repo)
            this.error("--repo is required when using --verifiable (git source mode)");
          if (!flags.commit)
            this.error("--commit is required when using --verifiable (git source mode)");
          try {
            assertCommitSha40(flags.commit);
          } catch (e: any) {
            this.error(e?.message || String(e));
          }
        } else if (flags["image-ref"]) {
          verifiableMode = "prebuilt";
          try {
            assertEigencloudContainersImageRef(flags["image-ref"]);
          } catch (e: any) {
            this.error(e?.message || String(e));
          }
        } else {
          this.error(
            "When using --verifiable, you must provide either --repo/--commit or --image-ref",
          );
        }
      } else {
        // Interactive verifiable selection when --verifiable is not set.
        // If the user explicitly provided --dockerfile, assume they want the normal local-build flow.
        if (!flags.dockerfile) {
          const useVerifiable = await promptUseVerifiableBuild();
          if (useVerifiable) {
            const sourceType = await promptVerifiableSourceType();
            verifiableMode = sourceType;
          }
        }
      }

      if (verifiableMode === "git") {
        const inputs: SubmitBuildRequest = flags.verifiable
          ? {
              repoUrl: flags.repo!,
              gitRef: flags.commit!,
              dockerfilePath: flags["build-dockerfile"],
              caddyfilePath: undefined,
              buildContextPath: flags["build-context"],
              dependencies: flags["build-dependencies"],
            }
          : await promptVerifiableGitSourceInputs();

        // Prompt for env file after git inputs
        envFilePath = await getEnvFileInteractive(flags["env-file"]);
        const includeTlsCaddyfile = isTlsEnabledFromEnvFile(envFilePath);
        if (includeTlsCaddyfile && !inputs.caddyfilePath) {
          inputs.caddyfilePath = "Caddyfile";
        }

        this.log(chalk.blue("Building from source with verifiable build..."));
        this.log("");

        const buildClient = await getBuildClient();
        const { build, verified } = await runVerifiableBuildAndVerify(buildClient, inputs, {
          onLog: (chunk) => process.stdout.write(chunk),
        });

        if (!build.imageUrl || !build.imageDigest) {
          this.error(
            "Build completed but did not return imageUrl/imageDigest; cannot upgrade verifiable build",
          );
        }

        verifiableImageUrl = build.imageUrl;
        verifiableImageDigest = build.imageDigest;

        for (const line of formatVerifiableBuildSummary({
          imageUrl: build.imageUrl,
          imageDigest: build.imageDigest,
          repoUrl: build.repoUrl,
          gitRef: build.gitRef,
          dependencies: build.dependencies,
          provenanceSignature: verified.provenanceSignature,
        })) {
          this.log(line);
        }
      }

      if (verifiableMode === "prebuilt") {
        const imageRef = flags.verifiable
          ? flags["image-ref"]!
          : await promptVerifiablePrebuiltImageRef();
        try {
          assertEigencloudContainersImageRef(imageRef);
        } catch (e: any) {
          this.error(e?.message || String(e));
        }

        this.log(chalk.blue("Resolving and verifying prebuilt verifiable image..."));
        this.log("");

        const digest = await resolveDockerHubImageDigest(imageRef);
        const buildClient = await getBuildClient();
        const verify = await buildClient.verify(digest);
        if (verify.status !== "verified") {
          this.error(`Provenance verification failed: ${verify.error}`);
        }

        verifiableImageUrl = imageRef;
        verifiableImageDigest = digest;

        for (const line of formatVerifiableBuildSummary({
          imageUrl: imageRef,
          imageDigest: digest,
          repoUrl: verify.repoUrl,
          gitRef: verify.gitRef,
          dependencies: undefined,
          provenanceSignature: verify.provenanceSignature,
        })) {
          this.log(line);
        }
      }

      // 2. Get dockerfile path interactively (skip when using verifiable image)
      const isVerifiable = verifiableMode !== "none";
      const dockerfilePath = isVerifiable ? "" : await getDockerfileInteractive(flags.dockerfile);
      const buildFromDockerfile = dockerfilePath !== "";

      // 3. Get image reference interactively (context-aware)
      const imageRef = verifiableImageUrl
        ? verifiableImageUrl
        : await getImageReferenceInteractive(flags["image-ref"], buildFromDockerfile);

      // 4. Get env file path interactively
      envFilePath = envFilePath ?? (await getEnvFileInteractive(flags["env-file"]));

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

      const { prepared, gasEstimate } = isVerifiable
        ? await prepareUpgradeFromVerifiableBuild(
            {
              appId: appID,
              privateKey,
              rpcUrl,
              environment,
              imageRef,
              imageDigest: verifiableImageDigest!,
              envFilePath,
              instanceType,
              logVisibility,
              resourceUsageMonitoring,
              skipTelemetry: true,
            },
            logger,
          )
        : await prepareUpgrade(
            {
              appId: appID,
              privateKey,
              rpcUrl,
              environment,
              dockerfilePath,
              imageRef,
              envFilePath,
              instanceType,
              logVisibility,
              resourceUsageMonitoring,
              skipTelemetry: true,
            },
            logger,
          );

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
      const res = await executeUpgrade(
        prepared,
        {
          maxFeePerGas: gasEstimate.maxFeePerGas,
          maxPriorityFeePerGas: gasEstimate.maxPriorityFeePerGas,
        },
        logger,
        true, // skipTelemetry
      );

      // 12. Watch until upgrade completes
      await watchUpgrade(res.appId, privateKey, rpcUrl, environment, logger, getClientId(), true); // skipTelemetry

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
