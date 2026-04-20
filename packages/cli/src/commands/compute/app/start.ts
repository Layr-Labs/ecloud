import { Command, Args, Flags } from "@oclif/core";
import { createComputeClient } from "../../../client";
import { commonFlags, timelockFlags, applyTxOverrides } from "../../../flags";
import {
  getEnvironmentConfig,
  estimateTransactionGas,
  encodeStartAppData,
  isMainnet,
} from "@layr-labs/ecloud-sdk";
import { getOrPromptAppID, confirm } from "../../../utils/prompts";
import { getPrivateKeyInteractive } from "../../../utils/prompts";
import { createViemClients } from "../../../utils/viemClients";
import { printIdentityContext, executeWithIdentity, printTransactionResult } from "../../../utils/identityTransaction";
import { handleTimelockExecute, handleTimelockCancel } from "../../../utils/timelockExecute";
import chalk from "chalk";
import { withTelemetry } from "../../../telemetry";
import type { Address } from "viem";

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
    force: Flags.boolean({
      description: "Skip all confirmation prompts",
      default: false,
    }),
    ...timelockFlags,
  };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(AppLifecycleStart);
      const compute = await createComputeClient(flags);

      const environment = flags.environment;
      const environmentConfig = getEnvironmentConfig(environment);
      const rpcUrl = flags.rpcUrl || environmentConfig.defaultRPCURL;
      const privateKey = await getPrivateKeyInteractive(flags["private-key"]);

      if (flags.execute) {
        await handleTimelockExecute({ opId: flags.execute, environment, privateKey, rpcUrl, log: this.log.bind(this), error: this.error.bind(this) });
        return;
      }
      if (flags.cancel) {
        await handleTimelockCancel({ opId: flags.cancel, environment, privateKey, rpcUrl, log: this.log.bind(this), error: this.error.bind(this) });
        return;
      }

      const appId = await getOrPromptAppID({
        appID: args["app-id"],
        environment: flags["environment"]!,
        privateKey,
        rpcUrl,
        action: "start",
      });

      const { publicClient, walletClient, address } = createViemClients({
        privateKey,
        rpcUrl,
        environment,
      });

      const identity = printIdentityContext(environment, address, this.log.bind(this));

      const callData = encodeStartAppData(appId);
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

      if (isMainnet(environmentConfig) && !flags.force) {
        const costInfo = finalTx ? ` (cost: up to ${finalTx.maxCostEth} ETH)` : "";
        const confirmed = await confirm(`This will start app ${appId}${costInfo}. Continue?`);
        if (!confirmed) {
          this.log(`\n${chalk.gray(`Start cancelled`)}`);
          return;
        }
      }

      if (identity.type === "eoa") {
        const res = await compute.app.start(appId, { gas: finalTx });
        if (!res.tx) {
          this.log(`\n${chalk.gray(`Start failed`)}`);
        } else {
          this.log(`\n✅ ${chalk.green(`App started successfully`)}`);
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
          pendingMessage: `Starting app ${appId}...`,
          txDescription: "StartApp",
          gas: finalTx,
        });

        this.log("");
        printTransactionResult(result, this.log.bind(this));
        if (result.type === "direct") {
          this.log(`\n✅ ${chalk.green(`App started successfully`)}`);
        }
      }
    });
  }
}
