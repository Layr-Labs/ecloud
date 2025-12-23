import { Args, Command, Flags } from "@oclif/core";
import chalk from "chalk";
import { commonFlags, validateCommonFlags } from "../../../flags";
import { createBuildClient } from "../../../client";
import { withTelemetry } from "../../../telemetry";
import { formatSourceLink } from "../../../utils/build";
import { promptBuildIdFromRecentBuilds } from "../../../utils/prompts";
import { privateKeyToAccount } from "viem/accounts";
import { addHexPrefix } from "@layr-labs/ecloud-sdk";

export default class BuildVerify extends Command {
  static description = "Verify provenance for a build or image";

  static examples = [
    `$ ecloud compute build verify sha256:abc123...`,
    `$ ecloud compute build verify abc123-def456-...`,
  ];

  static args = {
    identifier: Args.string({
      description: "Build ID, image digest (sha256:...), or git commit SHA",
      required: false,
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
      const { args, flags } = await this.parse(BuildVerify);
      const validatedFlags = await validateCommonFlags(flags, { requirePrivateKey: !args.identifier });
      const client = await createBuildClient(validatedFlags);

      this.log(chalk.gray("Fetching provenance..."));

      try {
        let identifier = args.identifier;
        if (!identifier) {
          const billingAddress = privateKeyToAccount(
            addHexPrefix(validatedFlags["private-key"]!),
          ).address;
          identifier = await promptBuildIdFromRecentBuilds({ client, billingAddress, limit: 20 });
        }

        const result = await client.verify(identifier);

        if (flags.json) {
          this.log(JSON.stringify(result, null, 2));
          return;
        }

        if (result.status === "verified") {
          this.log(chalk.green("Provenance signature verified ✓"));
          this.log("");
          this.log(`Image:   ${chalk.cyan(result.imageUrl)}`);
          this.log(`Digest:  ${chalk.dim(result.imageDigest)}`);
          this.log(`Source:  ${formatSourceLink(result.repoUrl, result.gitRef)}`);
          this.log(`BuildID: ${result.buildId}`);
          this.log("");
          this.log(chalk.green("All components traceable to source ✓"));
        } else {
          this.log(chalk.red(`Verification failed: ${result.error}`));
          if (result.buildId) this.log(`BuildID: ${result.buildId}`);
        }
      } catch (error) {
        this.log(chalk.red("Verification failed"));
        throw error;
      }
    });
  }
}


