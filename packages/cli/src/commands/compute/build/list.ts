import { Command, Flags } from "@oclif/core";
import chalk from "chalk";
import { privateKeyToAccount } from "viem/accounts";
import type { Build } from "@layr-labs/ecloud-sdk";
import { addHexPrefix } from "@layr-labs/ecloud-sdk";
import { commonFlags, validateCommonFlags } from "../../../flags";
import { createBuildClient } from "../../../client";
import { withTelemetry } from "../../../telemetry";
import { formatBuildStatus } from "../../../utils/buildInfo";
import Table from "cli-table3";
import {
  terminalWidth,
  formatRepoDisplay,
  formatImageDisplay,
  provenanceSummary,
  formatHumanTime,
} from "../../../utils/cliFormat";

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

      const tw = terminalWidth();
      // With 7 columns, narrow terminals get hard to read. Fall back to stacked output.
      const shouldStack = tw < 110;

      this.log("");
      this.log(chalk.bold(`Builds for ${billingAddress} (${validatedFlags.environment}):`));
      this.log("");

      if (shouldStack) {
        for (const r of rows) {
          this.log(`${r.status}  ${chalk.cyan(r.buildId)}  ${r.created}`);
          this.log(`  Repo:   ${r.repo}`);
          this.log(`  Commit: ${r.commit}`);
          this.log(`  Image:  ${r.image}`);
          this.log(`  Prov:   ${r.prov}`);
          this.log(chalk.gray("  ───────────────────────────────────────────────────────────────"));
        }
      } else {
        // Allocate flexible width to the "wide" columns (repo/commit/image) based on terminal width.
        // Note: cli-table3 includes borders/padding; this is intentionally approximate.
        const fixed = 36 + 10 + 20 + 14; // id + status + created + prov
        const remaining = Math.max(30, tw - fixed);
        const repoW = Math.max(18, Math.floor(remaining * 0.28));
        const commitW = Math.max(18, Math.floor(remaining * 0.36));
        const imageW = Math.max(18, remaining - repoW - commitW);

        const table = new Table({
          head: [
            chalk.bold("ID"),
            chalk.bold("Status"),
            chalk.bold("Repo"),
            chalk.bold("Commit"),
            chalk.bold("Image"),
            chalk.bold("Created"),
            chalk.bold("Prov"),
          ],
          colWidths: [36, 10, repoW, commitW, imageW, 20, 14],
          wordWrap: true,
          style: { "padding-left": 0, "padding-right": 1, head: [], border: [] },
        });

        for (const r of rows) {
          table.push([r.buildId, r.status, r.repo, r.commit, r.image, r.created, r.prov]);
        }
        this.log(table.toString());
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
