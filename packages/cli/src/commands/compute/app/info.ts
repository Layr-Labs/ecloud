import { Command, Args, Flags } from "@oclif/core";
import { createAppClient } from "../../../client";
import { commonFlags } from "../../../flags";

export default class AppInfo extends Command {
  static description = "Show detailed instance info";

  static args = {
    "app-id": Args.string({
      description: "App ID or name",
      required: false,
    }),
  };

  static flags = {
    ...commonFlags,
    watch: Flags.boolean({
      description: "Watch info continuously",
      char: "w",
      default: false,
    }),
    "address-count": Flags.integer({
      description: "Number of addresses to display",
      default: 1,
    }),
  };

  async run() {
    const { args, flags } = await this.parse(AppInfo);
    const app = await createAppClient(flags);

    await app.info({
      appID: args["app-id"],
      watch: flags.watch,
      addressCount: flags["address-count"],
    });
  }
}

