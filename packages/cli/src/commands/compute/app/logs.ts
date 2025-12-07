import { Command, Args, Flags } from "@oclif/core";
import { getEnvironmentConfig } from "@layr-labs/ecloud-sdk";
import { createAppClient } from "../../../client";
import { commonFlags } from "../../../flags";
import { getOrPromptAppID } from "../../../utils/prompts";

export default class AppLogs extends Command {
  static description = "View app logs";

  static args = {
    "app-id": Args.string({
      description: "App ID or name",
      required: false,
    }),
  };

  static flags = {
    ...commonFlags,
    watch: Flags.boolean({
      description: "Watch logs continuously",
      char: "w",
      default: false,
    }),
  };

  async run() {
    const { args, flags } = await this.parse(AppLogs);
    const app = await createAppClient(flags);

    // Get environment config
    const environment = flags.environment || "sepolia";
    const environmentConfig = getEnvironmentConfig(environment);
    const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;

    // Get app ID interactively if not provided
    const appID = await getOrPromptAppID({
      appID: args["app-id"],
      environment,
      privateKey: flags["private-key"],
      rpcUrl,
      action: "view logs for",
    });

    // Call SDK with the resolved app ID
    await app.logs({
      appID,
      watch: flags.watch,
    });
  }
}
