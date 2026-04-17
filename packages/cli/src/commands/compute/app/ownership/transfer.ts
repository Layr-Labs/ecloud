import { Command, Args, Flags } from "@oclif/core";
import {
  getEnvironmentConfig,
  isMainnet,
  estimateTransactionGas,
  encodeTransferOwnershipData,
} from "@layr-labs/ecloud-sdk";
import { withTelemetry } from "../../../../telemetry";
import { commonFlags, applyTxOverrides } from "../../../../flags";
import { createComputeClient } from "../../../../client";
import { getOrPromptAppID, getPrivateKeyInteractive, confirm } from "../../../../utils/prompts";
import { createViemClients } from "../../../../utils/viemClients";
import { printIdentityContext, executeWithIdentity, printTransactionResult } from "../../../../utils/identityTransaction";
import { isAddress } from "viem";
import type { Address } from "viem";
import chalk from "chalk";

export default class AppOwnershipTransfer extends Command {
  static description = "Transfer ownership of an app to a new address (Safe or Timelock enables governance mode)";

  static args = {
    "app-id": Args.string({
      description: "App ID or name",
      required: false,
    }),
  };

  static flags = {
    ...commonFlags,
    to: Flags.string({
      required: true,
      description: "New owner address (Safe or Timelock address enables governance mode)",
      env: "ECLOUD_NEW_OWNER",
    }),
    force: Flags.boolean({
      description: "Skip all confirmation prompts",
      default: false,
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(AppOwnershipTransfer);
      const compute = await createComputeClient(flags);

      const environment = flags.environment;
      const environmentConfig = getEnvironmentConfig(environment);
      const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;
      const privateKey = await getPrivateKeyInteractive(flags["private-key"]);

      const appId = await getOrPromptAppID({
        appID: args["app-id"],
        environment,
        privateKey,
        rpcUrl,
        action: "transfer ownership",
      });

      const newOwner = flags.to;
      if (!isAddress(newOwner)) {
        this.error(`Invalid address: ${newOwner}`);
      }

      const { publicClient, walletClient, address } = createViemClients({
        privateKey,
        rpcUrl,
        environment,
      });

      const identity = printIdentityContext(environment, address, this.log.bind(this));

      this.log(`\nApp:       ${chalk.bold(appId)}`);
      this.log(`New owner: ${chalk.bold(newOwner)}`);

      const callData = encodeTransferOwnershipData(appId, newOwner as Address);
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
          this.log(chalk.yellow(`\nGas override active — max fee: ${flags["max-fee-per-gas"] || "estimated"} gwei, priority fee: ${flags["max-priority-fee"] || "estimated"} gwei`));
        }
        if (finalTx.nonce != null) {
          this.log(chalk.yellow(`Nonce override active — nonce: ${finalTx.nonce}`));
        }
      }

      if ((isMainnet(environmentConfig) || identity.type !== "eoa") && !flags.force) {
        const confirmed = await confirm("Continue with ownership transfer?");
        if (!confirmed) {
          this.log(`\n${chalk.gray("Transfer cancelled")}`);
          return;
        }
      }

      if (identity.type === "eoa") {
        const res = await compute.app.transferOwnership(appId, newOwner, { gas: finalTx });
        this.log(`\n✅ ${chalk.green(`Ownership transferred successfully (tx: ${res.tx})`)}`);

        // Check whether timelocked mode was enabled as a result
        const nowTimelocked = await compute.app.isTimelocked(appId);
        if (nowTimelocked) {
          this.log(chalk.cyan("\nTimelocked mode enabled. Sensitive ops (upgrade, terminate, grant ADMIN) now go through Timelock.schedule → execute uniformly."));
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
          pendingMessage: `Transferring ownership of app ${appId} to ${newOwner}...`,
          txDescription: "TransferOwnership",
          gas: finalTx,
        });

        this.log("");
        printTransactionResult(result, this.log.bind(this));
        if (result.type === "direct") {
          this.log(`\n✅ ${chalk.green(`Ownership transferred successfully`)}`);
        }
      }
    });
  }
}
