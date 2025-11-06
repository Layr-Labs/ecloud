import { Command, Flags } from "@oclif/core";
import { loadClient } from "../../client";
import { commonFlags } from "../../flags";

export default class AppDeploy extends Command {
  static description = "Deploy new app";

  static flags = {
    ...commonFlags,
    image: Flags.string({ required: true }),
    owner: Flags.string(),
    cpu: Flags.integer(),
    memory: Flags.integer(),
    salt: Flags.string(),
  };

  async run() {
    const { flags } = await this.parse(AppDeploy);
    const client = loadClient(flags);

    const res = await client.app.deploy({
      image: flags.image,
      owner: flags.owner as `0x${string}` | undefined,
      resources: { cpu: flags.cpu, memoryMiB: flags.memory },
      salt: flags.salt as `0x${string}` | undefined,
    });

    this.log(JSON.stringify(res, null, 2));
  }
}
