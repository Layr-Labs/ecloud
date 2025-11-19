import { Command, Args, Flags } from "@oclif/core";
import { logVisibility } from "@ecloud/sdk";
import { loadClient } from "../../client";
import { commonFlags } from "../../flags";

export default class AppUpgrade extends Command {
  static description = "Upgrade existing deployment";

  static args = {
    "app-id": Args.string({
      description: "App ID or name to upgrade",
      required: false,
    }),
  };

  static flags = {
    ...commonFlags,
    dockerfile: Flags.string({
      required: false,
      description: "Path to Dockerfile",
      env: "ECLOUD_DOCKERFILE_PATH",
    }),
    "image-ref": Flags.string({
      required: false,
      description: "Image reference pointing to registry",
      env: "ECLOUD_IMAGE_REF",
    }),
    "env-file": Flags.string({
      required: false,
      description: 'Environment file to use (default: ".env")',
      default: ".env",
      env: "ECLOUD_ENVFILE_PATH",
    }),
    "log-visibility": Flags.string({
      required: false,
      description: "Log visibility setting: public, private, or off",
      options: ["public", "private", "off"],
      env: "ECLOUD_LOG_VISIBILITY",
    }),
    "instance-type": Flags.string({
      required: false,
      description:
        "Machine instance type to use e.g. g1-standard-4t, g1-standard-8t",
      env: "ECLOUD_INSTANCE_TYPE",
    }),
  };

  async run() {
    const { args, flags } = await this.parse(AppUpgrade);
    const client = loadClient(flags);

    const res = await client.app.upgrade(args["app-id"] as any, {
      dockerfile: flags.dockerfile,
      envFile: flags["env-file"],
      imageRef: flags["image-ref"],
      logVisibility: flags["log-visibility"] as logVisibility,
      instanceType: flags["instance-type"],
    });

    this.log(JSON.stringify(res, null, 2));
  }
}

