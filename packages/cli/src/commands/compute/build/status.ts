import { Args, Command, Flags } from "@oclif/core";
import chalk from "chalk";
import { commonFlags, validateCommonFlags } from "../../../flags";
import { createBuildClient } from "../../../client";
import { withTelemetry } from "../../../telemetry";
import { BUILD_STATUS } from "@layr-labs/ecloud-sdk";
import { formatSourceLink } from "../../../utils/build";

export default class BuildStatus extends Command {
  static description = "Get build status";

  static examples = [`$ ecloud compute build status abc123-def456-...`];

  static args = {
    buildId: Args.string({
      description: "Build ID",
      required: true,
    }),
  };

  static flags = {
    ...commonFlags,
    json: Flags.boolean({
      description: "Output JSON instead of formatted text",
      default: false,
    }),
  };

  async run(): Promise<void> {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(BuildStatus);
      const validatedFlags = await validateCommonFlags(flags, { requirePrivateKey: false });
      const client = await createBuildClient(validatedFlags);

      const build = await client.get(args.buildId);

      if (flags.json) {
        this.log(JSON.stringify(build, null, 2));
        return;
      }

      const status = build.status as (typeof BUILD_STATUS)[keyof typeof BUILD_STATUS];
      const statusColor = {
        [BUILD_STATUS.BUILDING]: chalk.yellow,
        [BUILD_STATUS.SUCCESS]: chalk.green,
        [BUILD_STATUS.FAILED]: chalk.red,
      }[status];

      const statusSymbol = {
        [BUILD_STATUS.BUILDING]: "◐",
        [BUILD_STATUS.SUCCESS]: "✓",
        [BUILD_STATUS.FAILED]: "✗",
      }[status];

      this.log(`Build:   ${chalk.cyan(build.buildId)}`);
      this.log(`Status:  ${statusColor(`${build.status} ${statusSymbol}`)}`);
      if (build.imageUrl) this.log(`Image:   ${build.imageUrl}`);
      this.log(`Source:  ${formatSourceLink(build.repoUrl, build.gitRef)}`);
      this.log(`Created: ${new Date(build.createdAt).toLocaleString()}`);
      if (build.errorMessage) this.log(`Error:   ${chalk.red(build.errorMessage)}`);
    });
  }
}
