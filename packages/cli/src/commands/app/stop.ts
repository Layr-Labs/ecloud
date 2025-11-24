import { Command, Args } from "@oclif/core";
import { loadClient } from "../../client";
import { commonFlags } from "../../flags";
import { getEnvironmentConfig, getOrPromptAppID } from "@ecloud/sdk";
import chalk from "chalk";

export default class AppLifecycleStop extends Command {
  static description = "Stop running app (stop GCP instance)";

  static args = {
    "app-id": Args.string({
      description: "App ID or name to stop",
      required: false,
    }),
  };

  static flags = {
    ...commonFlags,
  };

  async run() {
    const { args, flags } = await this.parse(AppLifecycleStop);
    const client = await loadClient(flags);

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
        action: "stop",
      }
    );

    const res = await client.app.stop(appId);

    if (!res.tx) {
      this.log(`\n${chalk.gray(`Stop aborted`)}`);
    } else {
      this.log(`\n✅ ${chalk.green(`App stopped successfully`)}`);
    }
  }
}

