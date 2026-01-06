import { Command, Flags } from "@oclif/core";
import { getEnvironmentConfig, UserApiClient, isMainnet } from "@layr-labs/ecloud-sdk";
import { withTelemetry } from "../../../telemetry";
import { commonFlags } from "../../../flags";
import { createComputeClient } from "../../../client";
import { createViemClients } from "../../../utils/viemClients";
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
  promptUseVerifiableBuild,
  promptVerifiableSourceType,
  promptVerifiableGitSourceInputs,
  promptVerifiablePrebuiltImageRef,
  imagePathToBlob,
} from "../../../utils/prompts";
import { invalidateProfileCache, setLinkedAppForDirectory } from "../../../utils/globalConfig";
import { getClientId } from "../../../utils/version";
import chalk from "chalk";
import { createBuildClient } from "../../../client";
import { formatVerifiableBuildSummary } from "../../../utils/build";
import { assertCommitSha40, runVerifiableBuildAndVerify } from "../../../utils/verifiableBuild";
import {
  assertEigencloudContainersImageRef,
  resolveDockerHubImageDigest,
} from "../../../utils/dockerhub";
import { isTlsEnabledFromEnvFile } from "../../../utils/tls";
import type { SubmitBuildRequest } from "@layr-labs/ecloud-sdk";

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

    // Verifiable build flags
    verifiable: Flags.boolean({
      description:
        "Enable verifiable build mode (either build from git source via --repo/--commit, or deploy a prebuilt verifiable image via --image-ref)",
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
      const { flags } = await this.parse(AppDeploy);
      const compute = await createComputeClient(flags);

      // Get validated values from flags (mutated by createComputeClient)
      const environment = flags.environment;
      const environmentConfig = getEnvironmentConfig(environment);
      const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;
      const privateKey = flags["private-key"]!;

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
      let suggestedAppBaseName: string | undefined;
      let skipDefaultAppName = false;
      let verifiableMode: VerifiableMode = "none";
      let envFilePath: string | undefined;

      const suggestAppBaseNameFromRepoUrl = (repoUrl: string): string | undefined => {
        const normalized = String(repoUrl || "")
          .trim()
          .replace(/\.git$/i, "")
          .replace(/\/+$/, "");
        if (!normalized) return undefined;

        // Best-effort: take the last path segment (works for https://.../owner/repo and git@...:owner/repo)
        const lastSlash = normalized.lastIndexOf("/");
        const lastColon = normalized.lastIndexOf(":");
        const idx = Math.max(lastSlash, lastColon);
        const raw = (idx >= 0 ? normalized.slice(idx + 1) : normalized).trim();
        if (!raw) return undefined;

        // Make it app-name-ish (validateAppName will still be enforced in the prompt)
        const cleaned = raw
          .toLowerCase()
          .replace(/_/g, "-")
          .replace(/[^a-z0-9-]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-+|-+$/g, "");
        return cleaned || undefined;
      };

      if (flags.verifiable) {
        // Explicit verifiable mode via flag: infer source based on provided flags.
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
            "Build completed but did not return imageUrl/imageDigest; cannot deploy verifiable build",
          );
        }

        verifiableImageUrl = build.imageUrl;
        verifiableImageDigest = build.imageDigest;
        suggestedAppBaseName = suggestAppBaseNameFromRepoUrl(build.repoUrl);

        for (const line of formatVerifiableBuildSummary({
          buildId: build.buildId,
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
        // For prebuilt images, both repoUrl and imageRef point to the shared eigencloud-containers
        // repo, so skip the default and require the user to enter a name
        skipDefaultAppName = true;

        for (const line of formatVerifiableBuildSummary({
          buildId: verify.buildId,
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

      // 1. Get dockerfile path interactively (skip when using verifiable image)
      const isVerifiable = verifiableMode !== "none";
      const dockerfilePath = isVerifiable ? "" : await getDockerfileInteractive(flags.dockerfile);
      const buildFromDockerfile = dockerfilePath !== "";

      // 2. Get image reference interactively (context-aware)
      // If verifiable build was used, force image-ref to the built image URL.
      const imageRef = verifiableImageUrl
        ? verifiableImageUrl
        : await getImageReferenceInteractive(flags["image-ref"], buildFromDockerfile);

      // 3. Get app name interactively
      const appName = await getOrPromptAppName(
        flags.name,
        environment,
        imageRef,
        suggestedAppBaseName,
        skipDefaultAppName,
      );

      // 4. Get env file path interactively
      envFilePath = envFilePath ?? (await getEnvFileInteractive(flags["env-file"]));

      // 5. Get instance type interactively
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

      const { prepared, gasEstimate } = isVerifiable
        ? await compute.app.prepareDeployFromVerifiableBuild({
            name: appName,
            imageRef,
            imageDigest: verifiableImageDigest!,
            envFile: envFilePath,
            instanceType,
            logVisibility,
            resourceUsageMonitoring,
          })
        : await compute.app.prepareDeploy({
            name: appName,
            dockerfile: dockerfilePath,
            imageRef,
            envFile: envFilePath,
            instanceType,
            logVisibility,
            resourceUsageMonitoring,
          });

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
      const res = await compute.app.executeDeploy(prepared, gasEstimate);

      // 11. Collect app profile while deployment is in progress (optional)
      if (!flags["skip-profile"]) {
        // Check if any profile flags were provided
        const hasProfileFlags = flags.website || flags.description || flags["x-url"] || flags.image;

        let profile: {
          name: string;
          website?: string;
          description?: string;
          xURL?: string;
          image?: Blob | File;
          imageName?: string;
        } | null = null;

        if (hasProfileFlags) {
          // Use flags directly if any were provided
          const { image, imageName } = imagePathToBlob(flags.image);
          profile = {
            name: appName,
            website: flags.website,
            description: flags.description,
            xURL: flags["x-url"],
            image,
            imageName,
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
            if (flags.verbose) {
              this.log("Profile collection skipped or cancelled");
            }
          }
        }

        if (profile) {
          // Upload profile if provided (non-blocking - warn on failure but don't fail deployment)
          this.log("Uploading app profile...");
          try {
            await compute.app.setProfile(res.appId, profile);
            this.log("✓ Profile uploaded successfully");

            try {
              invalidateProfileCache(environment);
            } catch (cacheErr: any) {
              if (flags.verbose) {
                this.log(`Failed to invalidate profile cache: ${cacheErr.message}`);
              }
            }
          } catch (uploadErr: any) {
            this.warn(`Failed to upload profile: ${uploadErr.message}`);
          }
        }
      }

      // 12. Watch until app is running
      const ipAddress = await compute.app.watchDeployment(res.appId);

      try {
        const cwd = process.env.INIT_CWD || process.cwd();
        setLinkedAppForDirectory(environment, cwd, res.appId);
      } catch (err: any) {
        this.debug(`Failed to link directory to app: ${err.message}`);
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
  privateKey: string,
  rpcUrl: string,
): Promise<Array<{ sku: string; description: string }>> {
  try {
    const { publicClient, walletClient } = createViemClients({
      privateKey,
      rpcUrl,
      environment: environmentConfig.name,
    });
    const userApiClient = new UserApiClient(
      environmentConfig,
      walletClient,
      publicClient,
      getClientId(),
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
