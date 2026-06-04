import { Command, Flags } from "@oclif/core";
import {
  getEnvironmentConfig,
  UserApiClient,
  isMainnet,
  WatchTimeoutError,
} from "@layr-labs/ecloud-sdk";
import type { PrepareDeployResult, GasEstimate } from "@layr-labs/ecloud-sdk";
import { withTelemetry } from "../../../telemetry";
import { commonFlags, applyTxOverrides } from "../../../flags";
import { createComputeClient } from "../../../client";
import { createViemClients } from "../../../utils/viemClients";
import {
  getDockerfileInteractive,
  getImageReferenceInteractive,
  getOrPromptAppName,
  getEnvFileInteractive,
  getInstanceTypeInteractive,
  type SkuInfo,
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
  isNonInteractive,
  collectMissingRequiredInputs,
} from "../../../utils/prompts";
import { invalidateProfileCache, setLinkedAppForDirectory } from "../../../utils/globalConfig";
import { getClientId } from "../../../utils/version";
import chalk from "chalk";
import { createBuildClient } from "../../../client";
import { formatVerifiableBuildSummary } from "../../../utils/build";
import { assertCommitSha40, runVerifiableBuildAndVerify } from "../../../utils/verifiableBuild";
import { getDashboardUrl } from "../../../utils/dashboard";
import {
  assertEigencloudContainersImageRef,
  resolveDockerHubImageDigest,
} from "../../../utils/dockerhub";
import { isTlsEnabledFromEnvFile } from "../../../utils/tls";
import { mergeInlineEnvVars } from "../../../utils/env";
import { EXIT_CODES, errorMessage } from "../../../utils/exitCodes";
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
    env: Flags.string({
      required: false,
      description:
        "Inline environment variable in KEY=VALUE format (can be specified multiple times)",
      multiple: true,
    }),
    "log-visibility": Flags.string({
      required: false,
      description:
        "Log visibility setting: public, private, or off (non-interactive default: private)",
      options: ["public", "private", "off"],
      env: "ECLOUD_LOG_VISIBILITY",
    }),
    "instance-type": Flags.string({
      required: false,
      description: "Machine instance type (e.g., g1-standard-4t, g1-standard-2s, g1-micro-1v)",
      env: "ECLOUD_INSTANCE_TYPE",
    }),
    "skip-profile": Flags.boolean({
      required: false,
      description: "Skip app profile setup",
      default: false,
    }),
    "resource-usage-monitoring": Flags.string({
      required: false,
      description:
        "Resource usage monitoring: enable or disable (non-interactive default: disable)",
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
    "build-caddyfile": Flags.string({
      description:
        "Optional path to Caddyfile inside the repo (relative to build context). If omitted, auto-detected from env file TLS settings",
      required: false,
      env: "ECLOUD_BUILD_CADDYFILE",
    }),
    force: Flags.boolean({
      description: "Skip all confirmation prompts",
      default: false,
      env: "ECLOUD_FORCE",
    }),
    "watch-timeout": Flags.integer({
      description:
        "Maximum seconds to wait for the app to start before returning a recovery hint (default: 600)",
      env: "ECLOUD_WATCH_TIMEOUT_SECONDS",
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(AppDeploy);

      // Non-interactive: report every missing required input at once instead of
      // failing one prompt at a time.
      if (isNonInteractive(flags)) {
        const missing = collectMissingRequiredInputs(
          {
            imageRef: flags["image-ref"],
            dockerfile: flags.dockerfile,
            verifiable: flags.verifiable,
            repo: flags.repo,
            commit: flags.commit,
            name: flags.name,
          },
          "name",
        );
        if (missing.length > 0) {
          this.error(
            `Missing required input(s) for non-interactive deploy:\n  - ${missing.join("\n  - ")}`,
            { exit: EXIT_CODES.INVALID_INPUT },
          );
        }
      }

      const compute = await createComputeClient(flags);

      // Get validated values from flags (mutated by createComputeClient)
      const environment = flags.environment;
      const environmentConfig = getEnvironmentConfig(environment);
      const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;
      const privateKey = flags["private-key"]!;

      // Early balance check — warn before interactive prompts if wallet has no funds
      const { publicClient, address } = createViemClients({
        privateKey,
        rpcUrl,
        environment,
      });
      const balance = await publicClient.getBalance({ address });
      if (balance === 0n) {
        const isSepolia = environmentConfig.chainID === BigInt(11155111);
        this.log(
          chalk.yellow(
            `\nWarning: Wallet ${chalk.bold(address)} has zero balance on ${environment}.`,
          ),
        );
        this.log(chalk.yellow(`You will need ETH to pay for deployment gas fees.`));
        if (isSepolia) {
          this.log(
            chalk.yellow(
              `Get Sepolia ETH from https://cloud.google.com/application/web3/faucet/ethereum/sepolia or https://sepoliafaucet.com/`,
            ),
          );
        }
        this.log(
          chalk.yellow(
            `Fund your wallet before the transaction step, or the deployment will fail.\n`,
          ),
        );
      }

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
          const useVerifiable = await promptUseVerifiableBuild(flags.force);
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
              caddyfilePath: flags["build-caddyfile"],
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

      // 1. Get dockerfile path interactively (skip when using verifiable image).
      // Also skip when --image-ref is explicitly provided and no --dockerfile was:
      // the user is deploying an existing image, so a stray Dockerfile in the
      // working directory must not trigger a "build or deploy existing?" prompt
      // (or, in non-interactive mode, silently flip the deploy to a local build).
      const isVerifiable = verifiableMode !== "none";
      const deployExistingImageRef = !!flags["image-ref"] && !flags.dockerfile;
      const dockerfilePath =
        isVerifiable || deployExistingImageRef
          ? ""
          : await getDockerfileInteractive(flags.dockerfile);
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

      // 4b. Merge inline --env KEY=VALUE vars (overrides env file values)
      if (flags.env && flags.env.length > 0) {
        envFilePath = mergeInlineEnvVars(envFilePath, flags.env);
      }

      // 5. Get instance type interactively
      const availableTypes = await fetchAvailableInstanceTypes(
        environment,
        environmentConfig,
        privateKey,
        rpcUrl,
      );
      const instanceType = await getInstanceTypeInteractive(
        flags["instance-type"],
        "", // No pinned default for new deployments; non-interactive falls back to g1-standard-2s
        availableTypes,
        isNonInteractive(flags),
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

      // Isolated billing is not yet available in the CLI.
      // Use the verifiable build path only for git-source builds where the build
      // service fully layers the image. For prebuilt image refs, route through
      // the normal prepareDeploy path so that layerRemoteImageIfNeeded can
      // add the ecloud runtime layer (startup script, KMS client, Caddy) if
      // the image doesn't already have it.
      // Build/push stage — failures here mean no image was produced and no
      // on-chain tx was attempted. Distinct exit code so callers don't confuse
      // it with an on-chain failure.
      let prepared: PrepareDeployResult["prepared"];
      let gasEstimate: GasEstimate;
      try {
        ({ prepared, gasEstimate } =
          verifiableMode === "git"
            ? await compute.app.prepareDeployFromVerifiableBuild({
                name: appName,
                imageRef,
                imageDigest: verifiableImageDigest!,
                envFile: envFilePath,
                instanceType,
                logVisibility,
                resourceUsageMonitoring,
                billTo: "developer",
              })
            : await compute.app.prepareDeploy({
                name: appName,
                dockerfile: dockerfilePath,
                imageRef,
                envFile: envFilePath,
                instanceType,
                logVisibility,
                resourceUsageMonitoring,
                billTo: "developer",
              }));
      } catch (err) {
        this.error(`Build/push failed (no deployment was attempted): ${errorMessage(err)}`, {
          exit: EXIT_CODES.BUILD_FAILED,
        });
      }

      // 9. Apply gas overrides if provided, show estimate, and prompt for confirmation on mainnet
      const finalTx = await applyTxOverrides(gasEstimate, flags, { publicClient, address });
      if (flags["max-fee-per-gas"] || flags["max-priority-fee"]) {
        this.log(
          chalk.yellow(
            `\nGas override active — max fee: ${flags["max-fee-per-gas"] || "estimated"} gwei, priority fee: ${flags["max-priority-fee"] || "estimated"} gwei`,
          ),
        );
      }
      if (finalTx.nonce != null) {
        this.log(chalk.yellow(`Nonce override active — nonce: ${finalTx.nonce}`));
      }
      this.log(`\nEstimated transaction cost: ${chalk.cyan(finalTx.maxCostEth)} ETH`);

      if (isMainnet(environmentConfig) && !flags.force) {
        const confirmed = await confirm(`Continue with deployment?`);
        if (!confirmed) {
          this.log(`\n${chalk.gray(`Deployment cancelled`)}`);
          return;
        }
      }

      // 10. Execute the deployment (on-chain stage). The image is already
      // built+pushed at this point; a failure here is distinct from a build
      // failure and a re-run will reuse the pushed image.
      let res: Awaited<ReturnType<typeof compute.app.executeDeploy>>;
      try {
        res = await compute.app.executeDeploy(prepared, finalTx);
      } catch (err) {
        this.error(
          `On-chain deployment failed after the image was built and pushed: ${errorMessage(err)}\n` +
            `The image is already pushed — re-running deploy will reuse it.`,
          { exit: EXIT_CODES.ONCHAIN_FAILED },
        );
      }

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
      let ipAddress: string | undefined;
      try {
        ipAddress = await compute.app.watchDeployment(res.appId, {
          timeoutSeconds: flags["watch-timeout"],
        });
      } catch (watchErr: any) {
        if (watchErr instanceof WatchTimeoutError) {
          this.log(
            `\n${chalk.yellow("⚠")} ${chalk.yellow(
              `Deployment did not reach Running within ${watchErr.elapsedSeconds}s (last status: ${watchErr.lastStatus ?? "unknown"}).`,
            )}`,
          );
          this.log(
            chalk.gray(
              `The deploy transaction succeeded, but the orchestrator hasn't reported the app as Running yet.`,
            ),
          );
          this.log(chalk.gray(`  appId:  ${res.appId}`));
          if (res.txHash) {
            this.log(chalk.gray(`  txHash: ${res.txHash}`));
          }
          this.log(
            chalk.gray(
              `Check progress later with: ${chalk.cyan(`ecloud compute app info ${res.appId}`)}`,
            ),
          );
          this.log(
            chalk.gray(
              `Override the watch timeout with the ${chalk.cyan("ECLOUD_WATCH_TIMEOUT_SECONDS")} environment variable.`,
            ),
          );
          this.exit(1);
        }
        throw watchErr;
      }

      try {
        const cwd = process.env.INIT_CWD || process.cwd();
        setLinkedAppForDirectory(environment, cwd, res.appId);
      } catch (err: any) {
        this.debug(`Failed to link directory to app: ${err.message}`);
      }

      this.log(
        `\n✅ ${chalk.green(`App deployed successfully ${chalk.bold(`(id: ${res.appId}, ip: ${ipAddress})`)}`)}`,
      );

      // Show dashboard link
      const dashboardUrl = getDashboardUrl(environment, res.appId);
      this.log(`\n${chalk.gray("View your app:")} ${chalk.blue.underline(dashboardUrl)}`);

      // Health verification hint — "Running" means container started, not serving traffic
      if (ipAddress) {
        this.log(
          chalk.gray(
            `\nNote: "Running" means the container started — verify it is serving traffic with:`,
          ),
        );
        this.log(chalk.gray(`  curl -s -o /dev/null -w "%{http_code}" http://${ipAddress}/`));
      }
    });
  }
}

/**
 * Fetch available instance types from backend
 */
async function fetchAvailableInstanceTypes(
  environment: string,
  environmentConfig: any,
  privateKey: string,
  rpcUrl: string,
): Promise<SkuInfo[]> {
  try {
    const { publicClient, walletClient } = createViemClients({
      privateKey,
      rpcUrl,
      environment,
    });
    const userApiClient = new UserApiClient(environmentConfig, walletClient, publicClient, {
      clientId: getClientId(),
    });

    const skuList = await userApiClient.getSKUs();
    if (skuList.skus.length === 0) {
      throw new Error("No instance types available from server");
    }

    return skuList.skus;
  } catch (err: any) {
    console.warn(`Failed to fetch instance types: ${err.message}`);
    // Return a default fallback
    return [{ sku: "g1-standard-4t", description: "4 vCPUs, 16 GB memory, TDX" }];
  }
}
