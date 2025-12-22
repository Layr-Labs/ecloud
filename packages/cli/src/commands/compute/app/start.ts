import { Command, Args } from "@oclif/core";
import { createComputeClient } from "../../../client";
import { commonFlags } from "../../../flags";
import {
  getEnvironmentConfig,
  estimateTransactionGas,
  encodeStartAppData,
  isMainnet,
} from "@layr-labs/ecloud-sdk";
import { getOrPromptAppID, confirm } from "../../../utils/prompts";
import { getPrivateKeyInteractive } from "../../../utils/prompts";
import chalk from "chalk";
import { withTelemetry } from "../../../telemetry";

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
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(AppLifecycleStart);
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
        action: "start",
      });

      // Estimate gas cost
      const callData = encodeStartAppData(appId as `0x${string}`);
      const estimate = await estimateTransactionGas({
        privateKey,
        rpcUrl,
        environmentConfig,
        to: environmentConfig.appControllerAddress as `0x${string}`,
        data: callData,
      });

      // On mainnet, prompt for confirmation with cost
      if (isMainnet(environmentConfig)) {
        const confirmed = await confirm(
          `This will cost up to ${estimate.maxCostEth} ETH. Continue?`,
        );
        if (!confirmed) {
          this.log(`\n${chalk.gray(`Start cancelled`)}`);
          return;
        }
      }

      const res = await compute.app.start(appId, {
        gas: {
          maxFeePerGas: estimate.maxFeePerGas,
          maxPriorityFeePerGas: estimate.maxPriorityFeePerGas,
        },
      });

      if (!res.tx) {
        this.log(`\n${chalk.gray(`Start failed`)}`);
      } else {
        this.log(`\n✅ ${chalk.green(`App started successfully`)}`);
      }
    });
  }
}
