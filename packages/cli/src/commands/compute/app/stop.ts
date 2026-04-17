import { Command, Args, Flags } from "@oclif/core";
import { createComputeClient } from "../../../client";
import { commonFlags, applyTxOverrides } from "../../../flags";
import {
  getEnvironmentConfig,
  estimateTransactionGas,
  encodeStopAppData,
  isMainnet,
} from "@layr-labs/ecloud-sdk";
import { getOrPromptAppID, confirm } from "../../../utils/prompts";
import { getPrivateKeyInteractive } from "../../../utils/prompts";
import { createViemClients } from "../../../utils/viemClients";
import { printIdentityContext, executeWithIdentity, printTransactionResult } from "../../../utils/identityTransaction";
import chalk from "chalk";
import { withTelemetry } from "../../../telemetry";
import type { Address } from "viem";

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
    force: Flags.boolean({
      description: "Skip all confirmation prompts",
      default: false,
    }),
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
      const privateKey = await getPrivateKeyInteractive(flags["private-key"]);

      // Resolve app ID (prompt if not provided)
      const appId = await getOrPromptAppID({
        appID: args["app-id"],
        environment: flags["environment"]!,
        privateKey,
        rpcUrl,
        action: "stop",
      });

      // Create viem clients
      const { publicClient, walletClient, address } = createViemClients({
        privateKey,
        rpcUrl,
        environment,
      });

      // Show which identity will be used
      const identity = printIdentityContext(environment, address, this.log.bind(this));

      // Encode the calldata
      const callData = encodeStopAppData(appId);

      // Gas estimation only works when sending from EOA directly.
      // For Safe/Timelock identities, msg.sender is the Safe/Timelock — not the EOA —
      // so estimating from EOA would revert. Skip estimation for non-EOA identities.
      const estimate = identity.type === "eoa"
        ? await estimateTransactionGas({
            publicClient,
            from: address,
            to: environmentConfig.appControllerAddress,
            data: callData,
          })
        : undefined;

      // Apply gas overrides if provided
      const finalTx = estimate ? await applyTxOverrides(estimate, flags, { publicClient, address }) : undefined;
      if (finalTx) {
        if (flags["max-fee-per-gas"] || flags["max-priority-fee"]) {
          this.log(chalk.yellow(`Gas override active — max fee: ${flags["max-fee-per-gas"] || "estimated"} gwei, priority fee: ${flags["max-priority-fee"] || "estimated"} gwei`));
        }
        if (finalTx.nonce != null) {
          this.log(chalk.yellow(`Nonce override active — nonce: ${finalTx.nonce}`));
        }
      }

      // On mainnet, prompt for confirmation with cost
      if (isMainnet(environmentConfig) && !flags.force) {
        const costInfo = finalTx ? ` (cost: up to ${finalTx.maxCostEth} ETH)` : "";
        const confirmed = await confirm(`This will stop app ${appId}${costInfo}. Continue?`);
        if (!confirmed) {
          this.log(`\n${chalk.gray(`Stop cancelled`)}`);
          return;
        }
      }

      // Route based on active identity
      if (identity.type === "eoa") {
        // Direct transaction (existing behavior)
        const res = await compute.app.stop(appId, { gas: finalTx });
        if (!res.tx) {
          this.log(`\n${chalk.gray(`Stop failed`)}`);
        } else {
          this.log(`\n✅ ${chalk.green(`App stopped successfully`)}`);
        }
      } else {
        // Identity-aware routing (Safe propose / Timelock schedule)
        const result = await executeWithIdentity({
          environment,
          eoaAddress: address,
          walletClient,
          publicClient,
          environmentConfig,
          to: environmentConfig.appControllerAddress as Address,
          data: callData,
          pendingMessage: `Stopping app ${appId}...`,
          txDescription: "StopApp",
          gas: finalTx,
        });

        this.log("");
        printTransactionResult(result, this.log.bind(this));

        if (result.type === "direct") {
          this.log(`\n✅ ${chalk.green(`App stopped successfully`)}`);
        }
      }
    });
  }
}
