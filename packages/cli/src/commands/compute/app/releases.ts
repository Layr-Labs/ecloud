import { Command, Args, Flags } from "@oclif/core";
import { getEnvironmentConfig, UserApiClient, type AppRelease } from "@layr-labs/ecloud-sdk";
import { commonFlags, validateCommonFlags } from "../../../flags";
import { getOrPromptAppID } from "../../../utils/prompts";
import { withTelemetry } from "../../../telemetry";
import { getClientId } from "../../../utils/version";
import { createViemClients } from "../../../utils/viemClients";
import chalk from "chalk";
import { formatAppRelease } from "../../../utils/releases";
import { Address } from "viem";
import {
  formatRepoDisplay,
  extractRepoName,
  formatImageDisplay,
  formatHumanTime,
  provenanceSummary,
} from "../../../utils/cliFormat";

function sortReleasesOldestFirst(releases: AppRelease[]): AppRelease[] {
  const toNum = (v: unknown): number => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
    return 0;
  };
  return [...releases].sort((a, b) => {
    const byBlock = toNum(a.createdAtBlock) - toNum(b.createdAtBlock);
    if (byBlock !== 0) return byBlock;
    return toNum(a.createdAt) - toNum(b.createdAt);
  });
}

function separator(): string {
  return chalk.gray("—".repeat(40));
}

function formatDepLines(deps?: NonNullable<AppRelease["build"]>["dependencies"]): string[] {
  if (!deps || Object.keys(deps).length === 0) return [];
  const entries = Object.entries(deps).sort(([a], [b]) => a.localeCompare(b));
  const lines: string[] = [];
  lines.push("  Dependencies:");
  for (const [digest, dep] of entries) {
    const repoUrl = dep.repoUrl || "";
    const name = extractRepoName(repoUrl);
    const repo = repoUrl ? formatRepoDisplay(repoUrl) : "-";
    lines.push(`  - ${digest}`);
    lines.push(`    ${name} (${repo})`);
  }
  return lines;
}

function provenanceSummaryFromBuild(build?: AppRelease["build"]): string {
  if (!build) return "-";
  return provenanceSummary({
    provenanceJson: build.provenanceJson,
    provenanceSignature: build.provenanceSignature,
    dependencies: build.dependencies as Record<string, unknown> | undefined,
  });
}

export default class AppReleases extends Command {
  static description =
    "Show app releases (including verifiable build + dependency builds when available)";

  static args = {
    "app-id": Args.string({
      description: "App ID or name",
      required: false,
    }),
  };

  static flags = {
    ...commonFlags,
    json: Flags.boolean({
      description: "Output JSON instead of formatted text",
      default: false,
    }),
    full: Flags.boolean({
      description: "Show the full (multi-line) release details instead of a table",
      default: false,
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(AppReleases);

      // Auth is required to call the API (you can view any app's releases, not just your own)
      const validatedFlags = await validateCommonFlags(flags);

      const environment = validatedFlags.environment || "sepolia";
      const environmentConfig = getEnvironmentConfig(environment);
      const rpcUrl = validatedFlags["rpc-url"] || environmentConfig.defaultRPCURL;
      const privateKey = validatedFlags["private-key"]!;

      const appID = await getOrPromptAppID({
        appID: args["app-id"],
        environment,
        privateKey,
        rpcUrl,
        action: "view releases for",
      });
      const { publicClient, walletClient } = createViemClients({
        privateKey,
        rpcUrl,
        environment,
      });
      const userApiClient = new UserApiClient(environmentConfig, walletClient, publicClient, getClientId());

      const data = await userApiClient.getApp(appID as Address);
      const releases = sortReleasesOldestFirst(data.releases);

      if (releases.length === 0) {
        this.log(`\nNo releases found for app ${chalk.gray(appID)}`);
        return;
      }

      if (flags.json) {
        this.log(JSON.stringify({ appID, releases }, null, 2));
        return;
      }

      this.log(`\nReleases for app ${chalk.gray(appID)}:\n`);

      if (flags.full) {
        for (let i = 0; i < releases.length; i++) {
          const lines = formatAppRelease(releases[i]!, i);
          for (const line of lines) this.log(line);
          if (i !== releases.length - 1) this.log(`\n${separator()}\n`);
        }
        return;
      }

      for (let i = 0; i < releases.length; i++) {
        const r = releases[i]!;
        const rel = r.rmsReleaseId ?? String(i);
        const block = r.createdAtBlock ? String(r.createdAtBlock) : "-";
        const created = r.createdAt ? formatHumanTime(r.createdAt) : "-";
        const repo = formatRepoDisplay(r.build?.repoUrl ?? "-");
        const commit = r.build?.gitRef ?? "-";
        const digest = r.imageDigest ?? r.build?.imageDigest ?? "-";
        const image = formatImageDisplay(r.build?.imageUrl ?? r.registryUrl ?? "-");
        const build = r.build?.buildId ?? "-";
        const prov = provenanceSummaryFromBuild(r.build);

        this.log(`${chalk.cyan(rel)}  ${created}  (block ${block})`);
        this.log(`  Repo:   ${repo}`);
        this.log(`  Commit: ${commit}`);
        this.log(`  Digest: ${digest}`);
        this.log(`  Image:  ${image}`);
        this.log(`  Build:  ${build}`);
        this.log(`  Provenance: ${prov}`);
        const depLines = formatDepLines(r.build?.dependencies);
        if (depLines.length) {
          for (const l of depLines) this.log(l);
        }
        this.log(chalk.gray("  ───────────────────────────────────────────────────────────────"));
      }

      this.log("");
      this.log(
        chalk.gray(
          `Tip: use ${chalk.yellow("--full")} for detailed release output, ${chalk.yellow(
            "--json",
          )} to copy/paste, and ${chalk.yellow(
            "ecloud compute build info <buildId>",
          )} for full build/provenance details.`,
        ),
      );
    });
  }
}
