import { Command, Flags } from "@oclif/core";
import chalk from "chalk";
import { privateKeyToAccount } from "viem/accounts";
import type { Build } from "@layr-labs/ecloud-sdk";
import { addHexPrefix } from "@layr-labs/ecloud-sdk";
import { commonFlags, validateCommonFlags } from "../../../flags";
import { createBuildClient } from "../../../client";
import { withTelemetry } from "../../../telemetry";
import { formatBuildStatus } from "../../../utils/buildInfo";
import {
  terminalWidth,
  shortenMiddle,
  formatRepoDisplay,
  formatImageDisplay,
  provenanceSummary,
  padRight,
  truncateCell,
  stripAnsi,
  formatHumanTime,
} from "../../../utils/cliTable";

export default class BuildList extends Command {
  static description = "List recent verifiable builds for a billing address (most recent first)";

  static examples = [
    `$ ecloud compute build list`,
    `$ ecloud compute build list --limit 10`,
    `$ ecloud compute build list --json`,
  ];

  static flags = {
    ...commonFlags,
    limit: Flags.integer({
      description: "Maximum number of builds to return (min 1, max 100)",
      default: 20,
    }),
    offset: Flags.integer({
      description: "Number of builds to skip",
      default: 0,
    }),
    json: Flags.boolean({
      description: "Output JSON instead of a table",
      default: false,
    }),
  };

  async run(): Promise<void> {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(BuildList);

      // Require a private key so we can derive billing address from stored credentials (keyring)
      // when the user is already logged in.
      const validatedFlags = await validateCommonFlags(flags);
      const client = await createBuildClient(validatedFlags);

      const billingAddress = privateKeyToAccount(
        addHexPrefix(validatedFlags["private-key"]!),
      ).address;

      const limit = Math.max(1, Math.min(100, flags.limit ?? 20));
      const offset = Math.max(0, flags.offset ?? 0);

      // API returns newest-first; for CLI readability we show oldest-first (latest at bottom).
      const builds = (await client.list({ billingAddress, limit, offset })).slice().reverse();

      if (flags.json) {
        this.log(JSON.stringify(builds, null, 2));
        return;
      }

      if (!builds.length) {
        this.log(`No builds found for ${billingAddress}`);
        return;
      }

      type Row = {
        buildId: string;
        status: string;
        repo: string;
        commit: string;
        image: string;
        created: string;
        prov: string;
      };

      // Keep raw-ish values; we will truncate based on terminal width.
      const rows: Row[] = builds.map((b: Build) => ({
        buildId: b.buildId || "-",
        status: formatBuildStatus(b.status),
        repo: formatRepoDisplay(b.repoUrl || "-"),
        commit: b.gitRef || "-",
        image: formatImageDisplay(b.imageUrl || "-"),
        created: formatHumanTime(b.createdAt),
        prov: provenanceSummary({
          provenanceJson: b.provenanceJson,
          provenanceSignature: b.provenanceSignature,
          dependencies: b.dependencies,
        }),
      }));

      const headers = {
        buildId: chalk.bold("ID"),
        status: chalk.bold("Status"),
        repo: chalk.bold("Repo"),
        commit: chalk.bold("Commit"),
        image: chalk.bold("Image"),
        created: chalk.bold("Created"),
        prov: chalk.bold("Prov"),
      };

      const sep = "  ";
      const tw = terminalWidth();

      // Compute widths, shrinking the "wide" columns to avoid wrapping.
      const maxContentLen = (key: keyof Row) =>
        Math.max(headers[key].length, ...rows.map((r) => stripAnsi(String(r[key])).length));

      const min = {
        buildId: 36,
        status: 7,
        repo: 18,
        commit: 40,
        image: 18,
        created: 18,
        prov: 12,
      };
      const max = {
        buildId: 36,
        status: 10,
        repo: 48,
        commit: 40,
        image: 48,
        created: 24,
        prov: 18,
      };

      let widths: Record<keyof Row, number> = {
        buildId: Math.min(max.buildId, Math.max(min.buildId, maxContentLen("buildId"))),
        status: Math.min(max.status, Math.max(min.status, maxContentLen("status"))),
        repo: Math.min(max.repo, Math.max(min.repo, maxContentLen("repo"))),
        commit: Math.min(max.commit, Math.max(min.commit, maxContentLen("commit"))),
        image: Math.min(max.image, Math.max(min.image, maxContentLen("image"))),
        created: Math.min(max.created, Math.max(min.created, maxContentLen("created"))),
        prov: Math.min(max.prov, Math.max(min.prov, maxContentLen("prov"))),
      };

      const totalWidth = () =>
        widths.buildId +
        widths.status +
        widths.repo +
        widths.commit +
        widths.image +
        widths.created +
        widths.prov +
        sep.length * 6;

      const shrink = (key: keyof Row, amount: number) => {
        const newW = Math.max(min[key], widths[key] - amount);
        widths[key] = newW;
      };

      // Prefer shrinking repo/image first to keep IDs and timestamps readable.
      while (totalWidth() > tw && (widths.repo > min.repo || widths.image > min.image)) {
        if (widths.repo > min.repo) shrink("repo", 1);
        if (totalWidth() <= tw) break;
        if (widths.image > min.image) shrink("image", 1);
      }

      // If we're still too wide, fall back to a stacked layout.
      const shouldStack = totalWidth() > tw;

      this.log("");
      this.log(chalk.bold(`Builds for ${billingAddress} (${validatedFlags.environment}):`));
      this.log("");

      if (shouldStack) {
        for (const r of rows) {
          this.log(`${padRight(r.status, 10)}  ${chalk.cyan(r.buildId)}  ${r.created}`);
          this.log(`  Repo:   ${r.repo}`);
          this.log(`  Commit: ${r.commit}`);
          this.log(`  Image:  ${r.image}`);
          this.log(`  Prov:   ${r.prov}`);
          this.log(chalk.gray("  ───────────────────────────────────────────────────────────────"));
        }
      } else {
        const headerLine = [
          padRight(headers.buildId, widths.buildId),
          padRight(headers.status, widths.status),
          padRight(headers.repo, widths.repo),
          padRight(headers.commit, widths.commit),
          padRight(headers.image, widths.image),
          padRight(headers.created, widths.created),
          padRight(headers.prov, widths.prov),
        ].join(sep);

        const ruleLine = [
          "-".repeat(widths.buildId),
          "-".repeat(widths.status),
          "-".repeat(widths.repo),
          "-".repeat(widths.commit),
          "-".repeat(widths.image),
          "-".repeat(widths.created),
          "-".repeat(widths.prov),
        ].join(sep);

        this.log(headerLine);
        this.log(ruleLine);

        for (const r of rows) {
          this.log(
            [
              padRight(r.buildId, widths.buildId),
              padRight(r.status, widths.status), // never truncate status
              padRight(truncateCell(shortenMiddle(r.repo, widths.repo), widths.repo), widths.repo),
              padRight(r.commit, widths.commit),
              padRight(
                truncateCell(shortenMiddle(r.image, widths.image), widths.image),
                widths.image,
              ),
              padRight(truncateCell(r.created, widths.created), widths.created),
              padRight(truncateCell(r.prov, widths.prov), widths.prov),
            ].join(sep),
          );
        }
      }

      this.log("");
      this.log(chalk.gray(`Showing ${builds.length} build(s) (limit=${limit}, offset=${offset})`));
      this.log(
        chalk.gray(
          `Tip: use ${chalk.yellow("ecloud compute build info <buildId>")} for full details, or add ${chalk.yellow(
            "--json",
          )} to copy/paste.`,
        ),
      );
    });
  }
}
