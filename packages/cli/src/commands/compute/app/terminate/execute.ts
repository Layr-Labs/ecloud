import { Command, Args, Flags } from "@oclif/core";
import { getEnvironmentConfig, isMainnet } from "@layr-labs/ecloud-sdk";
import { withTelemetry } from "../../../../telemetry";
import { commonFlags } from "../../../../flags";
import { createComputeClient } from "../../../../client";
import { getOrPromptAppID, confirm } from "../../../../utils/prompts";
import chalk from "chalk";
import { isAddress } from "viem";

export default class AppTerminateExecute extends Command {
  static description = "Execute a previously scheduled termination for a timelocked app once the delay has elapsed";

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
  };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(AppTerminateExecute);
      const compute = await createComputeClient(flags);

      const environment = flags.environment;
      const environmentConfig = getEnvironmentConfig(environment);
      const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;
      const privateKey = flags["private-key"]!;

      const timelockAddress = flags.timelock;
      if (!isAddress(timelockAddress)) this.error(`Invalid timelock address: ${timelockAddress}`);

      const appId = await getOrPromptAppID({ appID: args["app-id"], environment, privateKey, rpcUrl, action: "execute terminate" });

      const timelocked = await compute.app.isTimelocked(appId);
      if (!timelocked) {
        this.error("This app is not timelocked. Use 'ecloud compute app terminate' for direct termination.");
      }

      const readyAt = await compute.app.getTimelockTerminateReadyAt(appId, timelockAddress);

      if (readyAt === 0n) {
        this.error("No termination is scheduled for this app. Run 'ecloud compute app terminate schedule' first.");
      }

      const now = BigInt(Math.floor(Date.now() / 1000));
      if (now < readyAt) {
        const remaining = readyAt - now;
        const readyDate = new Date(Number(readyAt) * 1000).toLocaleString();
        this.error(`Termination is not ready yet. Executable after ${chalk.bold(readyDate)} (${remaining}s remaining).`);
      }

      const readyDate = new Date(Number(readyAt) * 1000).toLocaleString();
      this.log(`\nApp:       ${chalk.bold(appId)}`);
      this.log(`Timelock:  ${chalk.bold(timelockAddress)}`);
      this.log(`Scheduled: ${chalk.bold(readyDate)}`);
      this.log(chalk.red("\n⚠️  This will permanently destroy the app."));

      if (isMainnet(environmentConfig)) {
        const confirmed = await confirm("Execute termination?");
        if (!confirmed) {
          this.log(`\n${chalk.gray("Execution cancelled")}`);
          return;
        }
      }

      const { tx } = await compute.app.executeTimelockTerminate(appId, timelockAddress, {});

      this.log(`\n✅ ${chalk.green(`App terminated successfully (tx: ${tx})`)}`);
    });
  }
}
