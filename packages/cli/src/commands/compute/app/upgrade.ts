import { Command, Args, Flags } from "@oclif/core";
import {
  getEnvironmentConfig,
  UserApiClient,
  isMainnet,
  WatchTimeoutError,
} from "@layr-labs/ecloud-sdk";
import type { PrepareUpgradeResult, GasEstimate } from "@layr-labs/ecloud-sdk";
import { withTelemetry } from "../../../telemetry";
import { commonFlags, applyTxOverrides } from "../../../flags";
import { createBuildClient, createComputeClient } from "../../../client";
import { createViemClients } from "../../../utils/viemClients";
import {
  getDockerfile,
  getImageReferenceInteractive,
  getEnvFile,
  getInstanceType,
  getLogSettings,
  getResourceUsageMonitoring,
  getOrPromptAppID,
  LogVisibility,
  ResourceUsageMonitoring,
  confirm,
  promptUseVerifiableBuild,
  promptVerifiableSourceType,
  promptVerifiableGitSourceInputs,
  promptVerifiablePrebuiltImageRef,
  isNonInteractive,
  collectMissingRequiredInputs,
} from "../../../utils/prompts";
import { getClientId } from "../../../utils/version";
import { fetchAvailableInstanceTypes } from "../../../utils/instanceTypes";
import { setLinkedAppForDirectory, invalidateProfileCache } from "../../../utils/globalConfig";
import chalk from "chalk";
import { formatVerifiableBuildSummary } from "../../../utils/build";
import { assertCommitSha40, runVerifiableBuildAndVerify } from "../../../utils/verifiableBuild";
import { getDashboardUrl } from "../../../utils/dashboard";
import {
  assertEigencloudContainersImageRef,
  resolveDockerHubImageDigest,
} from "../../../utils/dockerhub";
import { isTlsEnabledFromEnvFile, TLS_DISABLED_WARNING } from "../../../utils/tls";
import { mergeInlineEnvVars } from "../../../utils/env";
import { stageFailure } from "../../../utils/exitCodes";
import type { SubmitBuildRequest } from "@layr-labs/ecloud-sdk";

/**
 * After an upgrade, reconcile the indexer-served release digest against the
 * digest we just deployed. Match → confirm. Timeout → warn (propagation in
 * progress) but do not fail. Unknown expected digest → skip. Fail-open: a
 * reconciliation error never blocks the already-successful upgrade.
 */
export async function reconcileAndReport(
  cmd: { log(message?: string): void; warn(message: string): void; debug?(message: string): void },
  compute: { app: { reconcileReleaseDigest(appId: string, expected: string, opts?: { intervalMs?: number; timeoutMs?: number }): Promise<{ matched: boolean; lastDigest?: string; elapsedMs: number }> } },
  appId: string,
  expectedDigest: string | undefined,
): Promise<void> {
  if (!expectedDigest) {
    return; // can't reconcile without a target; no regression vs. prior behavior
  }
  try {
    // Use the SDK's default poll cadence and timeout (currently 3s / 45s).
    const result = await compute.app.reconcileReleaseDigest(appId, expectedDigest);
    if (result.matched) {
      cmd.log(`Upgraded to ${expectedDigest}`);
    } else {
      cmd.warn(
        `New release not yet visible — indexer propagation in progress. ` +
          `Re-check with 'ecloud compute app releases ${appId}' shortly.`,
      );
    }
  } catch (err: any) {
    cmd.debug?.(`reconcileReleaseDigest failed (ignored): ${err?.message ?? err}`);
  }
}

export default class AppUpgrade extends Command {
  static description = "Upgrade existing deployment";

  static args = {
    "app-id": Args.string({
      description: "App ID or name to upgrade (env: ECLOUD_APP_ID)",
      required: false,
    }),
  };

  static flags = {
    ...commonFlags,
    name: Flags.string({
      required: false,
      description: "Update the app's profile name after upgrade",
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
    "resource-usage-monitoring": Flags.string({
      required: false,
      description:
        "Resource usage monitoring: enable or disable (non-interactive default: disable)",
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
        "Maximum seconds to wait for the upgrade to complete before returning a recovery hint (default: 600)",
      env: "ECLOUD_WATCH_TIMEOUT_SECONDS",
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(AppUpgrade);

      // Resolve the app to upgrade from the positional arg or ECLOUD_APP_ID env
      // (oclif Args don't support env bindings directly).
      const appIdInput = args["app-id"] ?? process.env.ECLOUD_APP_ID;

      // Resolve the interactivity decision once (flag › CI › !TTY) and thread it
      // into the optional-input helpers. They take it as a parameter rather than
      // re-deriving from process internally, so --non-interactive is honored
      // even on a TTY and the helpers stay pure/testable.
      const nonInteractive = isNonInteractive(flags);

      // Non-interactive: report every missing required input at once instead of
      // failing one prompt at a time.
      if (nonInteractive) {
        const missing = collectMissingRequiredInputs(
          {
            imageRef: flags["image-ref"],
            dockerfile: flags.dockerfile,
            verifiable: flags.verifiable,
            repo: flags.repo,
            commit: flags.commit,
          },
          "app-id",
        );
        if (!appIdInput) {
          missing.push("app-id (positional arg or ECLOUD_APP_ID)");
        }
        if (missing.length > 0) {
          const { message, exit } = stageFailure(
            "upgrade",
            "invalid-input",
            `Missing required input(s) for non-interactive upgrade:\n  - ${missing.join("\n  - ")}`,
          );
          this.error(message, { exit });
        }
      }

      const compute = await createComputeClient(flags);

      // Get validated values from flags (mutated by createComputeClient)
      const environment = flags.environment;
      const environmentConfig = getEnvironmentConfig(environment);
      const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;
      const privateKey = flags["private-key"]!;

      // 1. Get app ID interactively if not provided
      const appID = await getOrPromptAppID({
        appID: appIdInput,
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
        envFilePath = await getEnvFile(flags["env-file"], nonInteractive);
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

      // 2. Get dockerfile path interactively (skip when using verifiable image).
      // Also skip when --image-ref is explicitly provided and no --dockerfile was:
      // the user is upgrading to an existing image, so a stray Dockerfile in the
      // working directory must not trigger a "build or deploy existing?" prompt
      // (or, in non-interactive mode, silently flip the upgrade to a local build).
      const isVerifiable = verifiableMode !== "none";
      const deployExistingImageRef = !!flags["image-ref"] && !flags.dockerfile;
      const dockerfilePath =
        isVerifiable || deployExistingImageRef
          ? ""
          : await getDockerfile(flags.dockerfile, nonInteractive);
      const buildFromDockerfile = dockerfilePath !== "";

      // 3. Get image reference interactively (context-aware)
      const imageRef = verifiableImageUrl
        ? verifiableImageUrl
        : await getImageReferenceInteractive(flags["image-ref"], buildFromDockerfile);

      // 4. Get env file path interactively
      envFilePath = envFilePath ?? (await getEnvFile(flags["env-file"], nonInteractive));

      // 4b. Merge inline --env KEY=VALUE vars (overrides env file values)
      if (flags.env && flags.env.length > 0) {
        envFilePath = mergeInlineEnvVars(envFilePath, flags.env);
      }

      // 4c. Warn if DOMAIN is unset — the app will run, but nothing binds
      // ports 80/443, so HTTP(S) requests are refused with no other signal.
      if (!isTlsEnabledFromEnvFile(envFilePath)) {
        this.warn(TLS_DISABLED_WARNING);
      }

      // 5. Get current instance type (best-effort, used as default)
      const { publicClient, walletClient, address } = createViemClients({
        privateKey,
        rpcUrl,
        environment,
      });
      let currentInstanceType = "";
      try {
        const userApiClient = new UserApiClient(environmentConfig, walletClient, publicClient, {
          clientId: getClientId(),
        });
        const infos = await userApiClient.getInfos([appID], 1);
        if (infos.length > 0) {
          currentInstanceType = infos[0].machineType || "";
        }
      } catch {
        // Ignore errors - will use first available as default
      }

      // 6. Get instance type interactively
      const availableTypes = await fetchAvailableInstanceTypes(
        environment,
        environmentConfig,
        privateKey,
        rpcUrl,
      );
      const instanceType = await getInstanceType(
        flags["instance-type"],
        currentInstanceType,
        availableTypes,
        nonInteractive,
      );

      // 7. Get log visibility interactively
      const logSettings = await getLogSettings(
        flags["log-visibility"] as LogVisibility | undefined,
        nonInteractive,
      );

      // 8. Get resource usage monitoring interactively
      const resourceUsageMonitoring = await getResourceUsageMonitoring(
        flags["resource-usage-monitoring"] as ResourceUsageMonitoring | undefined,
        nonInteractive,
      );

      // 9. Prepare upgrade (builds image, pushes to registry, prepares batch, estimates gas)
      const logVisibility = logSettings.publicLogs
        ? "public"
        : logSettings.logRedirect
          ? "private"
          : "off";

      // Use the verifiable build path only for git-source builds where the build
      // service fully layers the image. For prebuilt image refs, route through
      // the normal prepareUpgrade path so that layerRemoteImageIfNeeded can
      // add the ecloud runtime layer (startup script, KMS client, Caddy) if
      // the image doesn't already have it.
      // Build/push stage — failures here mean no image was produced and no
      // on-chain tx was attempted.
      let prepared: PrepareUpgradeResult["prepared"];
      let gasEstimate: GasEstimate;
      try {
        ({ prepared, gasEstimate } =
          verifiableMode === "git"
            ? await compute.app.prepareUpgradeFromVerifiableBuild(appID, {
                imageRef,
                imageDigest: verifiableImageDigest!,
                envFile: envFilePath,
                instanceType,
                logVisibility,
                resourceUsageMonitoring,
              })
            : await compute.app.prepareUpgrade(appID, {
                dockerfile: dockerfilePath,
                imageRef,
                envFile: envFilePath,
                instanceType,
                logVisibility,
                resourceUsageMonitoring,
              }));
      } catch (err) {
        const { message, exit } = stageFailure("upgrade", "build", err);
        this.error(message, { exit });
      }

      // Digest we expect the upgrade to publish, for post-upgrade reconciliation.
      const expectedDigest: string | undefined = verifiableImageDigest ?? prepared.imageDigest;

      // 10. Apply gas overrides if provided, show estimate, and prompt for confirmation on mainnet
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
        const confirmed = await confirm(`Continue with upgrade?`);
        if (!confirmed) {
          this.log(`\n${chalk.gray(`Upgrade cancelled`)}`);
          return;
        }
      }

      // 11. Execute the upgrade (on-chain stage). Image already built+pushed;
      // a failure here is distinct from a build failure and a re-run reuses the
      // pushed image.
      let res: Awaited<ReturnType<typeof compute.app.executeUpgrade>>;
      try {
        res = await compute.app.executeUpgrade(prepared, finalTx);
      } catch (err) {
        const { message, exit } = stageFailure("upgrade", "onchain", err);
        this.error(message, { exit });
      }

      // 12. Watch until upgrade completes
      try {
        await compute.app.watchUpgrade(res.appId, { timeoutSeconds: flags["watch-timeout"] });
      } catch (err: any) {
        if (err instanceof WatchTimeoutError) {
          this.log("");
          this.log(
            chalk.yellow(
              `Timed out after ${err.elapsedSeconds}s waiting for upgrade to complete (last status: ${err.lastStatus ?? "unknown"}).`,
            ),
          );
          this.log(chalk.gray("The on-chain transaction was submitted; the orchestrator may"));
          this.log(chalk.gray("still be processing. To check the current status, run:"));
          this.log("");
          this.log(`  ${chalk.cyan(`ecloud compute app info ${res.appId}`)}`);
          this.log("");
          this.log(chalk.gray(`appId:  ${res.appId}`));
          this.log(chalk.gray(`txHash: ${res.txHash}`));
          this.log(
            chalk.gray(
              `(override the watch deadline with ECLOUD_WATCH_TIMEOUT_SECONDS, currently ${err.timeoutSeconds}s)`,
            ),
          );
          this.exit(1);
        }
        throw err;
      }

      try {
        const cwd = process.env.INIT_CWD || process.cwd();
        setLinkedAppForDirectory(environment, cwd, res.appId);
      } catch (err: any) {
        this.debug(`Failed to link directory to app: ${err.message}`);
      }

      this.log(
        `\n✅ ${chalk.green(`App upgraded successfully ${chalk.bold(`(id: ${res.appId}, image: ${res.imageRef})`)}`)}`,
      );

      await reconcileAndReport(
        {
          log: (m?: string) => this.log(m),
          warn: (m: string) => this.warn(m),
          debug: (m: string) => this.debug(m),
        },
        compute,
        res.appId,
        expectedDigest,
      );

      // Update profile name if --name was provided (merge with existing profile to avoid wiping fields)
      if (flags.name) {
        try {
          const { publicClient, walletClient } = createViemClients({
            privateKey,
            rpcUrl,
            environment,
          });
          const userApiClient = new UserApiClient(environmentConfig, walletClient, publicClient, {
            clientId: getClientId(),
          });
          const infos = await userApiClient.getInfos([res.appId], 1);
          const existing = infos[0]?.profile;

          await compute.app.setProfile(res.appId, {
            name: flags.name,
            website: existing?.website,
            description: existing?.description,
            xURL: existing?.xURL,
          });
          invalidateProfileCache(environment);
          this.log(`✓ Profile name updated to "${flags.name}"`);
        } catch (err: any) {
          this.warn(`Upgrade succeeded but failed to update profile name: ${err.message}`);
        }
      }

      // Show dashboard link
      const dashboardUrl = getDashboardUrl(environment, res.appId);
      this.log(`\n${chalk.gray("View your app:")} ${chalk.blue.underline(dashboardUrl)}`);

      // Health verification hint — "Running" means container started, not serving traffic
      this.log(
        chalk.gray(
          `\nNote: "Running" means the container started. Verify your app is serving traffic before considering the upgrade complete.`,
        ),
      );
    });
  }
}
