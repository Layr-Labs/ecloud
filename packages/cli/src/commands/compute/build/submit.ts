import { Command, Flags } from "@oclif/core";
import chalk from "chalk";
import { validateCommonFlags, commonFlags } from "../../../flags";
import { createBuildClient, createBillingClient } from "../../../client";
import { withTelemetry } from "../../../telemetry";
import type { Build } from "@layr-labs/ecloud-sdk";
import { BUILD_STATUS, ConflictError } from "@layr-labs/ecloud-sdk";
import { formatVerifiableBuildSummary } from "../../../utils/build";
import type { VerifyProvenanceResult } from "@layr-labs/ecloud-sdk";
import { assertCommitSha40, runVerifiableBuildAndVerify } from "../../../utils/verifiableBuild";
import { promptVerifiableGitSourceInputs } from "../../../utils/prompts";

export default class BuildSubmit extends Command {
  static description = "Submit a new verifiable build";

  static examples = [
    `$ ecloud compute build submit --repo https://github.com/myorg/myapp --commit abc123...`,
    `$ ecloud compute build submit --repo https://github.com/myorg/myapp --commit abc123... --dependencies sha256:def456...`,
    `$ ecloud compute build submit --repo https://github.com/myorg/myapp --commit abc123... --build-caddyfile Caddyfile`,
    `$ ecloud compute build submit --repo https://github.com/myorg/myapp --commit abc123... --no-follow`,
  ];

  static flags = {
    ...commonFlags,
    repo: Flags.string({
      description: "Git repository URL",
      required: false,
      env: "ECLOUD_BUILD_REPO",
    }),
    commit: Flags.string({
      description: "Git commit SHA (40 hex characters)",
      required: false,
      env: "ECLOUD_BUILD_COMMIT",
    }),
    dockerfile: Flags.string({
      description: "Path to Dockerfile",
      default: "Dockerfile",
      env: "ECLOUD_BUILD_DOCKERFILE",
    }),
    "build-caddyfile": Flags.string({
      description:
        "Optional path to Caddyfile inside the repo (relative to build context). If omitted, no Caddyfile is copied into the image",
      required: false,
      env: "ECLOUD_BUILD_CADDYFILE",
    }),
    context: Flags.string({
      description: "Build context path",
      default: ".",
      env: "ECLOUD_BUILD_CONTEXT",
    }),
    dependencies: Flags.string({
      description: "Dependency image digests (sha256:...)",
      multiple: true,
    }),
    "no-follow": Flags.boolean({
      description: "Don't follow logs, exit after submission",
      default: false,
    }),
    json: Flags.boolean({
      description: "Output JSON instead of formatted text",
      default: false,
    }),
  };

  async run(): Promise<void> {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(BuildSubmit);
      const validatedFlags = await validateCommonFlags(flags);

      const interactiveInputs =
        flags.repo && flags.commit ? undefined : await promptVerifiableGitSourceInputs();

      const repoUrl = flags.repo ?? interactiveInputs!.repoUrl;
      const gitRef = flags.commit ?? interactiveInputs!.gitRef;
      const dockerfilePath = flags.dockerfile ?? interactiveInputs!.dockerfilePath;
      const buildContextPath = flags.context ?? interactiveInputs!.buildContextPath;
      const dependencies =
        flags.dependencies && flags.dependencies.length > 0
          ? flags.dependencies
          : interactiveInputs?.dependencies;
      const caddyfilePath = flags["build-caddyfile"] ?? interactiveInputs?.caddyfilePath;

      try {
        assertCommitSha40(gitRef);
      } catch (e: any) {
        this.error(e?.message || String(e));
      }

      const client = await createBuildClient(validatedFlags);

      const buildRequest = {
        repoUrl,
        gitRef,
        dockerfilePath,
        caddyfilePath,
        buildContextPath,
        dependencies,
      };

      this.log(chalk.gray("Submitting build..."));

      try {
        if (flags["no-follow"]) {
          const { buildId } = await this.submitWithCreditGatedRetry(
            client,
            buildRequest,
            validatedFlags,
          );

          this.log(chalk.green(`Build submitted: ${buildId}`));

          if (flags.json) {
            this.log(JSON.stringify({ buildId }, null, 2));
          } else {
            this.log(`\nBuild ID: ${chalk.cyan(buildId)}`);
            this.log(
              `\nUse ${chalk.yellow(`ecloud compute build logs ${buildId} --follow`)} to watch progress`,
            );
            this.log("");
            this.log(chalk.gray("After the build completes, deploy or upgrade your app with the digest:"));
            this.log(chalk.gray("  ecloud compute app deploy --verifiable --image-ref <digest>"));
            this.log(chalk.gray("  ecloud compute app upgrade <app-id> --verifiable --image-ref <digest>"));
          }
          return;
        }

        this.log("");
        const { build, verified } = await runVerifiableBuildAndVerify(
          client,
          buildRequest,
          {
            onLog: (chunk) => process.stdout.write(chunk),
          },
          async () => {
            const billing = await createBillingClient(validatedFlags);
            const status = await billing.getStatus({ productId: "compute" });
            return (status.remainingCredits ?? 0) >= 5;
          },
        );

        this.log("");
        await this.printBuildResult(build, flags.json, verified);
      } catch (error: any) {
        this.log(chalk.red("Build submission failed"));
        if (error?.name === "BuildFailedError") {
          this.error(`Build failed: ${error.message}`);
        }
        throw error;
      }
    });
  }

  private async submitWithCreditGatedRetry(
    client: Awaited<ReturnType<typeof createBuildClient>>,
    request: Parameters<typeof client.submit>[0],
    flags: Awaited<ReturnType<typeof validateCommonFlags>>,
  ) {
    try {
      return await client.submit(request);
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;

      this.log(chalk.yellow("A build is already in progress. Checking account credits..."));
      const billing = await createBillingClient(flags);
      const status = await billing.getStatus({ productId: "compute" });
      const credits = status.remainingCredits ?? 0;

      if (credits < 5) {
        this.error(
          `You have $${credits.toFixed(2)} in credits. At least $5.00 is required to run parallel builds.\n` +
            `Run ${chalk.cyan("ecloud billing top-up")} to purchase more credits.`,
        );
      }

      this.log(
        chalk.green(`Account has $${credits.toFixed(2)} in credits. Submitting parallel build...`),
      );
      return client.submit({ ...request, force: true });
    }
  }

  private async printBuildResult(
    build: Build,
    json: boolean,
    verify?: VerifyProvenanceResult,
  ): Promise<void> {
    if (json) {
      this.log(JSON.stringify(build, null, 2));
      return;
    }

    if (build.status === BUILD_STATUS.SUCCESS && verify?.status === "verified") {
      for (const line of formatVerifiableBuildSummary({
        buildId: build.buildId,
        imageUrl: build.imageUrl || "",
        imageDigest: build.imageDigest || "",
        repoUrl: build.repoUrl,
        gitRef: build.gitRef,
        dependencies: build.dependencies,
        provenanceSignature: verify.provenanceSignature,
      })) {
        this.log(line);
      }

      // Show next steps with the actual digest
      this.log("");
      this.log(chalk.bold("Next Steps:"));
      this.log(
        chalk.gray(
          "Submitting a build alone doesn't update your app. Deploy or upgrade with the new digest:",
        ),
      );
      this.log("");
      this.log(chalk.yellow("  Deploy a new app:"));
      this.log(`    ecloud compute app deploy --verifiable --image-ref ${build.imageDigest}`);
      this.log("");
      this.log(chalk.yellow("  Upgrade an existing app:"));
      this.log(`    ecloud compute app upgrade <app-id> --verifiable --image-ref ${build.imageDigest}`);
    } else {
      this.log(chalk.red(`Build failed: ${build.errorMessage ?? "Unknown error"}`));
    }
  }
}
