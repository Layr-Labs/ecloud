import { Command, Args, Flags } from "@oclif/core";
import { createAppClient } from "../../client";
import { commonFlags } from "../../flags";
import { getEnvironmentConfig, getOrPromptAppID } from "@ecloud/sdk";
import chalk from "chalk";

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
        action: "terminate",
      }
    );

    const res = await app.terminate(appId, {
      force: flags.force,
    });

    if (!res.tx) {
      this.log(`\n${chalk.gray(`Termination aborted`)}`);
    } else {
      this.log(`\n✅ ${chalk.green(`App terminated successfully`)}`);
    }
  }
}

