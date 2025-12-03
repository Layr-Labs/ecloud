import { Command, Flags } from "@oclif/core";
import { logVisibility } from "@layr-labs/ecloud-sdk";
import { createAppClient } from "../../../client";
import { commonFlags } from "../../../flags";
import chalk from "chalk";

export default class AppDeploy extends Command {
  static description = "Deploy new app";

  static flags = {
    ...commonFlags,
    name: Flags.string({
      required: false,
      description: "Friendly name for the app",
      env: "ECLOUD_NAME",
    }),
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
      options: ["g1-standard-4t", "g1-standard-8t"],
      env: "ECLOUD_INSTANCE_TYPE",
    }),
  };

  async run() {
    const { flags } = await this.parse(AppDeploy);
    const app = await createAppClient(flags);

    const res = await app.deploy({
      name: flags.name,
      dockerfile: flags.dockerfile,
      envFile: flags["env-file"],
      imageRef: flags["image-ref"],
      logVisibility: flags["log-visibility"] as logVisibility,
      instanceType: flags["instance-type"],
    });

    if (!res.tx || !res.ipAddress) {
      this.log(`\n${chalk.gray(`Deploy ${res.ipAddress ? "failed" : "aborted"}`)}`);
    } else {
      this.log(`\n✅ ${chalk.green(`App deployed successfully ${chalk.bold(`(id: ${res.appID}, ip: ${res.ipAddress})`)}`)}`);
    }
  }
}
