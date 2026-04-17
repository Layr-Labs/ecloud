import { Command, Args, Flags } from "@oclif/core";
import { createComputeClient } from "../../../client";
import { commonFlags, applyTxOverrides } from "../../../flags";
import {
  getEnvironmentConfig,
  estimateTransactionGas,
  encodeTerminateAppData,
  isMainnet,
} from "@layr-labs/ecloud-sdk";
import { getOrPromptAppID, confirm } from "../../../utils/prompts";
import { getPrivateKeyInteractive } from "../../../utils/prompts";
import { createViemClients } from "../../../utils/viemClients";
import { printIdentityContext, executeWithIdentity, printTransactionResult } from "../../../utils/identityTransaction";
import chalk from "chalk";
import { withTelemetry } from "../../../telemetry";
import type { Address } from "viem";

export default class AppLifecycleTerminate extends Command {
  static description = "Terminate app (terminate GCP instance) permanently";

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
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(AppLifecycleTerminate);
      const compute = await createComputeClient(flags);

      const environment = flags.environment;
      const environmentConfig = getEnvironmentConfig(environment);
      const rpcUrl = flags.rpcUrl || environmentConfig.defaultRPCURL;
      const privateKey = await getPrivateKeyInteractive(flags["private-key"]);

      const appId = await getOrPromptAppID({
        appID: args["app-id"],
        environment: flags["environment"]!,
        privateKey,
        rpcUrl,
        action: "terminate",
      });

      const { publicClient, walletClient, address } = createViemClients({
        privateKey,
        rpcUrl,
        environment,
      });

      const identity = printIdentityContext(environment, address, this.log.bind(this));

      const callData = encodeTerminateAppData(appId);
      const estimate = identity.type === "eoa"
        ? await estimateTransactionGas({
            publicClient,
            from: address,
            to: environmentConfig.appControllerAddress,
            data: callData,
          })
        : undefined;

      const finalTx = estimate ? await applyTxOverrides(estimate, flags, { publicClient, address }) : undefined;
      if (finalTx) {
        if (flags["max-fee-per-gas"] || flags["max-priority-fee"]) {
          this.log(chalk.yellow(`Gas override active — max fee: ${flags["max-fee-per-gas"] || "estimated"} gwei, priority fee: ${flags["max-priority-fee"] || "estimated"} gwei`));
        }
        if (finalTx.nonce != null) {
          this.log(chalk.yellow(`Nonce override active — nonce: ${finalTx.nonce}`));
        }
      }

      if (!flags.force) {
        const costInfo = finalTx && isMainnet(environmentConfig)
          ? ` (cost: up to ${finalTx.maxCostEth} ETH)`
          : "";
        const confirmed = await confirm(`⚠️  Permanently destroy app ${appId}${costInfo}?`);
        if (!confirmed) {
          this.log(`\n${chalk.gray(`Termination aborted`)}`);
          return;
        }
      }

      if (identity.type === "eoa") {
        const res = await compute.app.terminate(appId, { gas: finalTx });
        if (!res.tx) {
          this.log(`\n${chalk.gray(`Termination failed`)}`);
        } else {
          this.log(`\n✅ ${chalk.green(`App terminated successfully`)}`);
        }
      } else {
        const result = await executeWithIdentity({
          environment,
          eoaAddress: address,
          walletClient,
          publicClient,
          environmentConfig,
          to: environmentConfig.appControllerAddress as Address,
          data: callData,
          pendingMessage: `Terminating app ${appId}...`,
          txDescription: "TerminateApp",
          gas: finalTx,
        });

        this.log("");
        printTransactionResult(result, this.log.bind(this));
        if (result.type === "direct") {
          this.log(`\n✅ ${chalk.green(`App terminated successfully`)}`);
        }
      }
    });
  }
}
