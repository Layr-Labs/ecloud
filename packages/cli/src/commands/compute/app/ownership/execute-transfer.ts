import { Command, Args, Flags } from "@oclif/core";
import { getEnvironmentConfig, isMainnet } from "@layr-labs/ecloud-sdk";
import { withTelemetry } from "../../../../telemetry";
import { commonFlags } from "../../../../flags";
import { createComputeClient } from "../../../../client";
import { getOrPromptAppID, confirm } from "../../../../utils/prompts";
import chalk from "chalk";
import { isAddress } from "viem";

export default class AppOwnershipExecuteTransfer extends Command {
  static description = "Execute a previously scheduled ownership transfer for a timelocked app once the delay has elapsed";

  static args = {
    "app-id": Args.string({ description: "App ID or name", required: false }),
  };

  static flags = {
    ...commonFlags,
    timelock: Flags.string({
      required: true,
      description: "Timelock contract address that owns the app",
      env: "ECLOUD_TIMELOCK_ADDRESS",
    }),
    to: Flags.string({
      required: true,
      description: "New owner address (must match the scheduled transfer)",
      env: "ECLOUD_NEW_OWNER",
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(AppOwnershipExecuteTransfer);
      const compute = await createComputeClient(flags);

      const environment = flags.environment;
      const environmentConfig = getEnvironmentConfig(environment);
      const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;
      const privateKey = flags["private-key"]!;

      const timelockAddress = flags.timelock;
      if (!isAddress(timelockAddress)) this.error(`Invalid timelock address: ${timelockAddress}`);

      const newOwner = flags.to;
      if (!isAddress(newOwner)) this.error(`Invalid new owner address: ${newOwner}`);

      const appId = await getOrPromptAppID({ appID: args["app-id"], environment, privateKey, rpcUrl, action: "execute transfer ownership" });

      const timelocked = await compute.app.isTimelocked(appId);
      if (!timelocked) {
        this.error("This app is not timelocked. Use 'ecloud compute app ownership transfer' for direct ownership transfer.");
      }

      const readyAt = await compute.app.getTimelockTransferOwnershipReadyAt(appId, timelockAddress, newOwner);

      if (readyAt === 0n) {
        this.error("No ownership transfer is scheduled for this app. Run 'ecloud compute app ownership schedule-transfer' first.");
      }

      const now = BigInt(Math.floor(Date.now() / 1000));
      if (now < readyAt) {
        const remaining = readyAt - now;
        const readyDate = new Date(Number(readyAt) * 1000).toLocaleString();
        this.error(`Transfer is not ready yet. Executable after ${chalk.bold(readyDate)} (${remaining}s remaining).`);
      }

      const readyDate = new Date(Number(readyAt) * 1000).toLocaleString();
      this.log(`\nApp:       ${chalk.bold(appId)}`);
      this.log(`Timelock:  ${chalk.bold(timelockAddress)}`);
      this.log(`New owner: ${chalk.bold(newOwner)}`);
      this.log(`Scheduled: ${chalk.bold(readyDate)}`);

      if (isMainnet(environmentConfig)) {
        const confirmed = await confirm("Execute ownership transfer?");
        if (!confirmed) {
          this.log(`\n${chalk.gray("Execution cancelled")}`);
          return;
        }
      }

      const { tx } = await compute.app.executeTimelockTransferOwnership(appId, timelockAddress, newOwner, {});

      this.log(`\n✅ ${chalk.green(`Ownership transferred successfully (tx: ${tx})`)}`);
    });
  }
}
