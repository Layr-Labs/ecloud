import { Command, Flags } from "@oclif/core";
import { createApp } from "@ecloud/sdk";

export default class AppCreate extends Command {
  static description = "Create a new app";

  // CreateApp flags
  static flags = {
    name: Flags.string(),
    language: Flags.string(),
    template: Flags.string(),
    templateVersion: Flags.string(),
    verbose: Flags.boolean(),
  };

  async run() {
    const { flags } = await this.parse(AppCreate);

    // Skip creating client and call createApp directly
    return createApp(flags, {
      info: (msg: string, ...args: any[]) => console.log(msg, ...args),
      warn: (msg: string, ...args: any[]) => console.warn(msg, ...args),
      error: (msg: string, ...args: any[]) => console.error(msg, ...args),
      debug: (msg: string, ...args: any[]) =>
        flags.verbose && console.debug(msg, ...args),
    });
  }
}
