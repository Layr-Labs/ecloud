import { Command, Args } from "@oclif/core";
import { createComputeClient } from "../../../client";
import { commonFlags } from "../../../flags";
import {
  getEnvironmentConfig,
  estimateTransactionGas,
  encodeStopAppData,
  isMainnet,
} from "@layr-labs/ecloud-sdk";
import { getOrPromptAppID, confirm } from "../../../utils/prompts";
import { getPrivateKeyInteractive } from "../../../utils/prompts";
import { createViemClients } from "../../../utils/viemClients";
import chalk from "chalk";
import { withTelemetry } from "../../../telemetry";

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
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(AppLifecycleStop);
      const compute = await createComputeClient(flags);

      // Get environment config (flags already validated by createComputeClient)
      const environment = flags.environment;
      const environmentConfig = getEnvironmentConfig(environment);

      // Get RPC URL (needed for contract queries and authentication)
      const rpcUrl = flags.rpcUrl || environmentConfig.defaultRPCURL;

      // Get private key for gas estimation
      const privateKey = flags["private-key"] || (await getPrivateKeyInteractive(environment));

      // Resolve app ID (prompt if not provided)
      const appId = await getOrPromptAppID({
        appID: args["app-id"],
        environment: flags["environment"]!,
        privateKey,
        rpcUrl,
        action: "stop",
      });

      // Create viem clients for gas estimation
      const { publicClient, address } = createViemClients({
        privateKey,
        rpcUrl,
        environment,
      });

      // Estimate gas cost
      const callData = encodeStopAppData(appId);
      const estimate = await estimateTransactionGas({
        publicClient,
        from: address,
        to: environmentConfig.appControllerAddress,
        data: callData,
      });

      // On mainnet, prompt for confirmation with cost
      if (isMainnet(environmentConfig)) {
        const confirmed = await confirm(
          `This will cost up to ${estimate.maxCostEth} ETH. Continue?`,
        );
        if (!confirmed) {
          this.log(`\n${chalk.gray(`Stop cancelled`)}`);
          return;
        }
      }

      const res = await compute.app.stop(appId, {
        gas: estimate,
      });

      if (!res.tx) {
        this.log(`\n${chalk.gray(`Stop failed`)}`);
      } else {
        this.log(`\n✅ ${chalk.green(`App stopped successfully`)}`);
      }
    });
  }
}
