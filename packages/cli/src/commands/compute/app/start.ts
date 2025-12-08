import { Command, Args } from "@oclif/core";
import { createAppClient } from "../../../client";
import { commonFlags } from "../../../flags";
import { getEnvironmentConfig } from "@layr-labs/ecloud-sdk";
import { getOrPromptAppID } from "../../../utils/prompts";
import chalk from "chalk";

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
    const app = await createAppClient(flags);


    // Get environment config
    const environment = flags.environment || "sepolia";
    const environmentConfig = getEnvironmentConfig(environment);
  
    // Get RPC URL (needed for contract queries and authentication)
    const rpcUrl = flags.rpcUrl || environmentConfig.defaultRPCURL;
    
    // Resolve app ID (prompt if not provided)
    const appId = await getOrPromptAppID(
      {
        appID: args["app-id"],
        environment: flags["environment"]!,
        privateKey: flags["private-key"],
        rpcUrl,
        action: "start",
      }
    );

    const res = await app.start(appId);

    if (!res.tx) {
      this.log(`\n${chalk.gray(`Start failed`)}`);
    } else {
      this.log(`\n✅ ${chalk.green(`App started successfully`)}`);
    }
  }
}

