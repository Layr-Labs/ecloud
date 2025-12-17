import { Args, Command, Flags } from "@oclif/core";
import { commonFlags, validateCommonFlags } from "../../../flags";
import { createBuildClient } from "../../../client";
import { withTelemetry } from "../../../telemetry";
import chalk from "chalk";
import { BUILD_STATUS } from "@layr-labs/ecloud-sdk";

export default class BuildLogs extends Command {
  static description = "Get or stream build logs";

  static examples = [
    `$ ecloud compute build logs abc123-def456-...`,
    `$ ecloud compute build logs abc123-def456-... --follow`,
    `$ ecloud compute build logs abc123-def456-... --tail 50`,
  ];

  static args = {
    buildId: Args.string({
      description: "Build ID",
      required: true,
    }),
  };

  static flags = {
    ...commonFlags,
    follow: Flags.boolean({
      char: "f",
      description: "Follow logs in real-time",
      default: false,
    }),
    tail: Flags.integer({
      description: "Show last N lines",
    }),
  };

  async run(): Promise<void> {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(BuildLogs);

      // Logs are owner-only, so require private key
      const validatedFlags = await validateCommonFlags(flags);
      const client = await createBuildClient(validatedFlags);

      if (flags.follow) {
        const pollIntervalMs = 2000;
        let lastLogLength = 0;

        while (true) {
          const build = await client.get(args.buildId);

          let logs = "";
          try {
            logs = await client.getLogs(args.buildId);
          } catch {
            // Logs may not be available yet
          }

          if (logs.length > lastLogLength) {
            process.stdout.write(logs.slice(lastLogLength));
            lastLogLength = logs.length;
          }

          if (build.status !== BUILD_STATUS.BUILDING) {
            process.stdout.write("\n");
            break;
          }

          await showCountdown(Math.ceil(pollIntervalMs / 1000));
        }
        return;
      }

      const logs = await client.getLogs(args.buildId);
      if (flags.tail !== undefined) {
        const lines = logs.split("\n");
        const tailedLines = lines.slice(-flags.tail);
        this.log(tailedLines.join("\n"));
      } else {
        this.log(logs);
      }
    });
  }
}

async function showCountdown(seconds: number): Promise<void> {
  for (let i = seconds; i >= 0; i--) {
    process.stdout.write(chalk.gray(`\rRefreshing in ${i}...`));
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  process.stdout.write("\r");
}
