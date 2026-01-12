import { Command, Flags } from "@oclif/core";
import chalk from "chalk";
import { privateKeyToAccount } from "viem/accounts";
import { addHexPrefix } from "@layr-labs/ecloud-sdk";
import { commonFlags, validateCommonFlags } from "../../../flags";
import { createBuildClient } from "../../../client";
import { withTelemetry } from "../../../telemetry";
import { formatBuildStatus } from "../../../utils/buildInfo";
import {
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

      this.log("");
      this.log(chalk.bold(`Builds for ${billingAddress} (${validatedFlags.environment}):`));
      this.log("");

      for (const b of builds) {
        const buildId = b.buildId || "-";
        const status = formatBuildStatus(b.status);
        const repo = formatRepoDisplay(b.repoUrl || "-");
        const commit = b.gitRef || "-";
        const image = formatImageDisplay(b.imageUrl || "-");
        const created = formatHumanTime(b.createdAt);
        const prov = provenanceSummary({
          provenanceJson: b.provenanceJson,
          provenanceSignature: b.provenanceSignature,
          dependencies: b.dependencies,
        });

        this.log(`${status}  ${chalk.cyan(buildId)}  ${created}`);
        this.log(`  Repo:   ${repo}`);
        this.log(`  Commit: ${commit}`);
        this.log(`  Image:  ${image}`);
        this.log(`  Prov:   ${prov}`);
        this.log(chalk.gray("  ───────────────────────────────────────────────────────────────"));
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
