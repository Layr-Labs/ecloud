import { Command, Args, Flags } from "@oclif/core";
import { createAppClient } from "../../../client";
import { commonFlags } from "../../../flags";
import { 
  getEnvironmentConfig, 
  estimateTransactionGas,
  encodeTerminateAppData,
  isMainnet,
} from "@layr-labs/ecloud-sdk";
import { getOrPromptAppID, confirm } from "../../../utils/prompts";
import { getPrivateKeyInteractive } from "../../../utils/prompts";
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

    // Get private key for gas estimation
    const privateKey = flags["private-key"] || await getPrivateKeyInteractive(environment);
    
    // Resolve app ID (prompt if not provided)
    const appId = await getOrPromptAppID(
      {
        appID: args["app-id"],
        environment: flags["environment"]!,
        privateKey,
        rpcUrl,
        action: "terminate",
      }
    );

    // Estimate gas cost
    const callData = encodeTerminateAppData(appId as `0x${string}`);
    const estimate = await estimateTransactionGas({
      privateKey,
      rpcUrl,
      environmentConfig,
      to: environmentConfig.appControllerAddress as `0x${string}`,
      data: callData,
    });

    // Ask for confirmation unless forced
    if (!flags.force) {
      const costInfo = isMainnet(environmentConfig) ? ` (cost: up to ${estimate.maxCostEth} ETH)` : "";
      const confirmed = await confirm(`⚠️  Permanently destroy app ${appId}${costInfo}?`);
      if (!confirmed) {
        this.log(`\n${chalk.gray(`Termination aborted`)}`);
        return;
      }
    }

    const res = await app.terminate(appId, {
      gas: {
        maxFeePerGas: estimate.maxFeePerGas,
        maxPriorityFeePerGas: estimate.maxPriorityFeePerGas,
      },
    });

    if (!res.tx) {
      this.log(`\n${chalk.gray(`Termination failed`)}`);
    } else {
      this.log(`\n✅ ${chalk.green(`App terminated successfully`)}`);
    }
  }
}

