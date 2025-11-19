import { Command, Args } from "@oclif/core";
import { loadClient } from "../../../client";
import { commonFlags } from "../../../flags";
import { getOrPromptAppID } from "@ecloud/sdk";

export default class AppLifecycleStart extends Command {
  static description = "Start stopped app (start GCP instance)";

  static args = {
    "app-id": Args.string({
      description: "App ID or name to start",
      required: false,
    }),
  };

  static flags = {
    ...commonFlags,
  };

  async run() {
    const { args, flags } = await this.parse(AppLifecycleStart);
    const client = loadClient(flags);

    // Resolve app ID (prompt if not provided)
    const appId = await getOrPromptAppID(
      args["app-id"],
      flags.environment,
    );

    const res = await client.app.lifecycle.start(appId);

    this.log(JSON.stringify(res, null, 2));
  }
}

