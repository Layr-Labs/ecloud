import { Command, Args, Flags } from "@oclif/core";
import { getEnvironmentConfig, UserApiClient, type AppRelease } from "@layr-labs/ecloud-sdk";
import { commonFlags, validateCommonFlags } from "../../../flags";
import { getOrPromptAppID } from "../../../utils/prompts";
import { withTelemetry } from "../../../telemetry";
import { getClientId } from "../../../utils/version";
import chalk from "chalk";
import { formatAppRelease } from "../../../utils/releases";
import { Address, isAddress } from "viem";
import {
  terminalWidth,
  padRight,
  shortenMiddle,
  truncateCell,
  formatRepoDisplay,
  extractRepoName,
  formatImageDisplay,
  formatHumanTime,
  provenanceSummary,
  stripAnsi,
} from "../../../utils/cliTable";

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

      const sep = "  ";
      const tw = terminalWidth();

      const maxContentLen = (key: keyof Row) =>
        Math.max(headers[key].length, ...rows.map((r) => stripAnsi(String(r[key])).length));

      const min = {
        rel: 4,
        block: 8,
        created: 18,
        repo: 18,
        commit: 40,
        digest: 18,
        image: 18,
        build: 36,
        prov: 12,
        deps: 8,
      };
      const max = {
        rel: 10,
        block: 12,
        created: 24,
        repo: 48,
        commit: 40,
        digest: 64,
        image: 48,
        build: 36,
        prov: 18,
        deps: 10,
      };

      let widths: Record<keyof Row, number> = {
        rel: Math.min(max.rel, Math.max(min.rel, maxContentLen("rel"))),
        block: Math.min(max.block, Math.max(min.block, maxContentLen("block"))),
        created: Math.min(max.created, Math.max(min.created, maxContentLen("created"))),
        repo: Math.min(max.repo, Math.max(min.repo, maxContentLen("repo"))),
        commit: Math.min(max.commit, Math.max(min.commit, maxContentLen("commit"))),
        digest: Math.min(max.digest, Math.max(min.digest, maxContentLen("digest"))),
        image: Math.min(max.image, Math.max(min.image, maxContentLen("image"))),
        build: Math.min(max.build, Math.max(min.build, maxContentLen("build"))),
        prov: Math.min(max.prov, Math.max(min.prov, maxContentLen("prov"))),
        deps: Math.min(max.deps, Math.max(min.deps, maxContentLen("deps"))),
      };

      const totalWidth = () =>
        widths.rel +
        widths.block +
        widths.created +
        widths.repo +
        widths.commit +
        widths.digest +
        widths.image +
        widths.build +
        widths.prov +
        widths.deps +
        sep.length * 9;

      const shrink = (key: keyof Row, amount: number) => {
        widths[key] = Math.max(min[key], widths[key] - amount);
      };

      while (
        totalWidth() > tw &&
        (widths.repo > min.repo || widths.image > min.image || widths.digest > min.digest)
      ) {
        if (widths.repo > min.repo) shrink("repo", 1);
        if (totalWidth() <= tw) break;
        if (widths.image > min.image) shrink("image", 1);
        if (totalWidth() <= tw) break;
        if (widths.digest > min.digest) shrink("digest", 1);
      }

      const shouldStack = totalWidth() > tw;

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

      const headerLine = [
        padRight(headers.rel, widths.rel),
        padRight(headers.block, widths.block),
        padRight(headers.created, widths.created),
        padRight(headers.repo, widths.repo),
        padRight(headers.commit, widths.commit),
        padRight(headers.digest, widths.digest),
        padRight(headers.image, widths.image),
        padRight(headers.build, widths.build),
        padRight(headers.prov, widths.prov),
        padRight(headers.deps, widths.deps),
      ].join(sep);

      const ruleLine = [
        "-".repeat(widths.rel),
        "-".repeat(widths.block),
        "-".repeat(widths.created),
        "-".repeat(widths.repo),
        "-".repeat(widths.commit),
        "-".repeat(widths.digest),
        "-".repeat(widths.image),
        "-".repeat(widths.build),
        "-".repeat(widths.prov),
        "-".repeat(widths.deps),
      ].join(sep);

      this.log(headerLine);
      this.log(ruleLine);

      for (const r of rows) {
        this.log(
          [
            padRight(truncateCell(r.rel, widths.rel), widths.rel),
            padRight(truncateCell(r.block, widths.block), widths.block),
            padRight(truncateCell(r.created, widths.created), widths.created),
            padRight(truncateCell(shortenMiddle(r.repo, widths.repo), widths.repo), widths.repo),
            padRight(r.commit, widths.commit),
            padRight(
              truncateCell(shortenMiddle(r.digest, widths.digest), widths.digest),
              widths.digest,
            ),
            padRight(
              truncateCell(shortenMiddle(r.image, widths.image), widths.image),
              widths.image,
            ),
            padRight(r.build, widths.build),
            padRight(truncateCell(r.prov, widths.prov), widths.prov),
            padRight(truncateCell(r.deps, widths.deps), widths.deps),
          ].join(sep),
        );
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
