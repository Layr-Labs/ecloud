import { Args, Command, Flags } from "@oclif/core";
import { commonFlags, validateCommonFlags } from "../../../flags";
import { createBuildClient } from "../../../client";
import { withTelemetry } from "../../../telemetry";
import { formatBuildInfo } from "../../../utils/buildInfo";
import { assertBuildId } from "../../../utils/verifiableBuild";
import { promptBuildIdFromRecentBuilds } from "../../../utils/prompts";
import { privateKeyToAccount } from "viem/accounts";
import { addHexPrefix } from "@layr-labs/ecloud-sdk";

export default class BuildInfo extends Command {
  static description = "Show full build details (including dependency builds)";

  static examples = [`$ ecloud compute build info 92d28b52-5f26-43ff-8c0b-3340f129e631`];

  static args = {
    buildId: Args.string({
      description: "Build ID",
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
      const { args, flags } = await this.parse(BuildInfo);
      const validatedFlags = await validateCommonFlags(flags, {
        requirePrivateKey: !args.buildId,
      });
      const client = await createBuildClient(validatedFlags);

      let buildId = args.buildId;
      if (!buildId) {
        const billingAddress = privateKeyToAccount(
          addHexPrefix(validatedFlags["private-key"]!),
        ).address;
        buildId = await promptBuildIdFromRecentBuilds({ client, billingAddress, limit: 20 });
      } else {
        try {
          assertBuildId(buildId);
        } catch (e: any) {
          this.error(e?.message || String(e));
        }
      }

      const build = await client.get(buildId);

      if (flags.json) {
        this.log(JSON.stringify(build, null, 2));
        return;
      }

      for (const line of formatBuildInfo(build)) {
        this.log(line);
      }
    });
  }
}
