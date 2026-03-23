import { Command, Args, Flags } from "@oclif/core";
import { getEnvironmentConfig, isMainnet } from "@layr-labs/ecloud-sdk";
import { withTelemetry } from "../../../../telemetry";
import { commonFlags } from "../../../../flags";
import { createComputeClient } from "../../../../client";
import { getOrPromptAppID, confirm } from "../../../../utils/prompts";
import chalk from "chalk";
import { isAddress } from "viem";

function parseDurationToSeconds(input: string): bigint {
  const match = input.match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d)?$/i);
  if (!match) throw new Error(`Invalid duration "${input}". Use format: 30s, 5m, 2h, 1d`);
  const value = parseFloat(match[1]);
  const unit = (match[2] || "s").toLowerCase();
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return BigInt(Math.ceil(value * multipliers[unit]));
}

export default class AppOwnershipScheduleTransfer extends Command {
  static description = "Schedule an ownership transfer for a timelocked app through its Timelock";

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
      description: "New owner address",
      env: "ECLOUD_NEW_OWNER",
    }),
    after: Flags.string({
      required: true,
      description: "Delay before transfer can execute (e.g. 30s, 5m, 2h, 1d)",
      env: "ECLOUD_OP_DELAY",
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(AppOwnershipScheduleTransfer);
      const compute = await createComputeClient(flags);

      const environment = flags.environment;
      const environmentConfig = getEnvironmentConfig(environment);
      const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;
      const privateKey = flags["private-key"]!;

      const timelockAddress = flags.timelock;
      if (!isAddress(timelockAddress)) this.error(`Invalid timelock address: ${timelockAddress}`);

      const newOwner = flags.to;
      if (!isAddress(newOwner)) this.error(`Invalid new owner address: ${newOwner}`);

      let delaySeconds: bigint;
      try {
        delaySeconds = parseDurationToSeconds(flags.after);
      } catch (e: any) {
        this.error(e.message);
      }

      const appId = await getOrPromptAppID({ appID: args["app-id"], environment, privateKey, rpcUrl, action: "schedule transfer ownership" });

      const timelocked = await compute.app.isTimelocked(appId);
      if (!timelocked) {
        this.error("This app is not timelocked. Use 'ecloud compute app ownership transfer' for direct ownership transfer.");
      }

      const readyAt = Math.floor(Date.now() / 1000) + Number(delaySeconds);
      const readyDate = new Date(readyAt * 1000).toLocaleString();

      this.log(`\nApp:       ${chalk.bold(appId)}`);
      this.log(`Timelock:  ${chalk.bold(timelockAddress)}`);
      this.log(`New owner: ${chalk.bold(newOwner)}`);
      this.log(`Delay:     ${chalk.bold(flags.after)} (executable after ${chalk.bold(readyDate)})`);

      if (isMainnet(environmentConfig)) {
        const confirmed = await confirm("Schedule this ownership transfer?");
        if (!confirmed) {
          this.log(`\n${chalk.gray("Scheduling cancelled")}`);
          return;
        }
      }

      const { tx } = await compute.app.scheduleTimelockTransferOwnership(appId, timelockAddress, newOwner, delaySeconds, {});

      this.log(`\n✅ ${chalk.green(`Ownership transfer scheduled (tx: ${tx})`)}`);
      this.log(chalk.cyan(`\nExecutable after: ${chalk.bold(readyDate)}`));
      this.log(chalk.cyan(`Run to execute:   ecloud compute app ownership execute-transfer --app=${appId} --timelock=${timelockAddress} --to=${newOwner}`));
    });
  }
}
