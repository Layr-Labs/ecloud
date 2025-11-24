import { Command, Args, Flags } from "@oclif/core";
import { createAppClient } from "../../client";
import { commonFlags } from "../../flags";

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

    await app.logs({
      appID: args["app-id"],
      watch: flags.watch,
    });
  }
}

