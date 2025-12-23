import { Command, Args, Flags } from "@oclif/core";
import { getEnvironmentConfig, UserApiClient, type AppRelease } from "@layr-labs/ecloud-sdk";
import { commonFlags, validateCommonFlags } from "../../../flags";
import { getOrPromptAppID } from "../../../utils/prompts";
import { withTelemetry } from "../../../telemetry";
import { getClientId } from "../../../utils/version";
import chalk from "chalk";
import { formatAppRelease } from "../../../utils/releases";
import { Address, isAddress } from "viem";
import Table from "cli-table3";
import {
  terminalWidth,
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

      // Releases endpoint is readable without auth; only require private key when we need to
      // resolve app names interactively (or when the provided identifier isn't an address).
      const rawAppId = args["app-id"];
      const needsPrivateKey = !rawAppId || !isAddress(rawAppId);
      const validatedFlags = await validateCommonFlags(flags, {
        requirePrivateKey: needsPrivateKey,
      });

      const environment = validatedFlags.environment || "sepolia";
      const environmentConfig = getEnvironmentConfig(environment);
      const rpcUrl = validatedFlags["rpc-url"] || environmentConfig.defaultRPCURL;
      const privateKey = validatedFlags["private-key"];

      const appID = await getOrPromptAppID({
        appID: args["app-id"],
        environment,
        privateKey,
        rpcUrl,
        action: "view releases for",
      });

      const userApiClient = new UserApiClient(environmentConfig, privateKey, rpcUrl, getClientId());

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

      type Row = {
        rel: string;
        block: string;
        created: string;
        repo: string;
        commit: string;
        digest: string;
        image: string;
        build: string;
        prov: string;
        deps: string;
      };

      const rows: Row[] = releases.map((r, i) => {
        const rel = r.rmsReleaseId ?? String(i);
        const block = r.createdAtBlock ? String(r.createdAtBlock) : "-";
        const created = r.createdAt ? formatHumanTime(r.createdAt) : "-";
        const repo = formatRepoDisplay(r.build?.repoUrl ?? "-");
        const commit = r.build?.gitRef ?? "-";
        const digest = r.imageDigest ?? r.build?.imageDigest ?? "-";
        const image = formatImageDisplay(r.build?.imageUrl ?? r.registryUrl ?? "-");
        const build = r.build?.buildId ?? "-";
        const prov = provenanceSummaryFromBuild(r.build);
        const depCount = r.build?.dependencies ? Object.keys(r.build.dependencies).length : 0;
        const deps = depCount > 0 ? `deps:${depCount}` : "-";
        return { rel, block, created, repo, commit, digest, image, build, prov, deps };
      });

      const headers = {
        rel: chalk.bold("Rel"),
        block: chalk.bold("Block"),
        created: chalk.bold("Created"),
        repo: chalk.bold("Repo"),
        commit: chalk.bold("Commit"),
        digest: chalk.bold("Digest"),
        image: chalk.bold("Image"),
        build: chalk.bold("Build"),
        prov: chalk.bold("Prov"),
        deps: chalk.bold("Deps"),
      };

      const tw = terminalWidth();
      // With 10 columns this gets unreadable on narrow terminals; fall back to stacked.
      const shouldStack = tw < 140;

      if (shouldStack) {
        for (const r of rows) {
          this.log(`${chalk.cyan(r.rel)}  ${r.created}  (block ${r.block})`);
          this.log(`  Repo:   ${r.repo}`);
          this.log(`  Commit: ${r.commit}`);
          this.log(`  Digest: ${r.digest}`);
          this.log(`  Image:  ${r.image}`);
          this.log(`  Build:  ${r.build}`);
          this.log(`  Provenance: ${r.prov}`);
          const relObj = releases.find((x, idx) => (x.rmsReleaseId ?? String(idx)) === r.rel);
          const depLines = formatDepLines(relObj?.build?.dependencies);
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
        return;
      }

      // Allocate flexible width to the "wide" columns based on terminal width.
      // Note: cli-table3 includes borders/padding; this is intentionally approximate.
      const fixed = 6 + 10 + 20 + 36 + 12 + 8 + 10; // rel + block + created + build + prov + deps + commit(min-ish)
      const remaining = Math.max(60, tw - fixed);
      const repoW = Math.max(18, Math.floor(remaining * 0.25));
      const digestW = Math.max(18, Math.floor(remaining * 0.35));
      const imageW = Math.max(18, remaining - repoW - digestW);

      const table = new Table({
        head: [
          headers.rel,
          headers.block,
          headers.created,
          headers.repo,
          headers.commit,
          headers.digest,
          headers.image,
          headers.build,
          headers.prov,
          headers.deps,
        ],
        colWidths: [6, 10, 20, repoW, 10, digestW, imageW, 36, 12, 8],
        wordWrap: true,
        style: { "padding-left": 0, "padding-right": 1, head: [], border: [] },
      });

      for (const r of rows) {
        table.push([
          r.rel,
          r.block,
          r.created,
          r.repo,
          r.commit,
          r.digest,
          r.image,
          r.build,
          r.prov,
          r.deps,
        ]);
      }

      this.log(table.toString());

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
