import { Command, Args, Flags } from "@oclif/core";
import { loadClient } from "../../../client";
import { commonFlags } from "../../../flags";
import { getOrPromptAppID } from "@ecloud/sdk";

export default class AppLifecycleTerminate extends Command {
  static description =
    "Terminate app (terminate GCP instance) permanently";

  static args = {
    "app-id": Args.string({
      description: "App ID or name to terminate",
      required: false,
    }),
  };

  static flags = {
    ...commonFlags,
    force: Flags.boolean({
      required: false,
      description: "Force termination without confirmation",
      default: false,
    }),
  };

  async run() {
    const { args, flags } = await this.parse(AppLifecycleTerminate);
    const client = loadClient(flags);

    // Resolve app ID (prompt if not provided)
    const appId = await getOrPromptAppID(
      args["app-id"],
      flags.environment,
    );

    const res = await client.app.lifecycle.terminate(appId, {
      force: flags.force,
    });

    this.log(JSON.stringify(res, null, 2));
  }
}

