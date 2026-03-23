import { Command, Args, Flags } from "@oclif/core";
import { getEnvironmentConfig, isMainnet } from "@layr-labs/ecloud-sdk";
import { withTelemetry } from "../../../../telemetry";
import { commonFlags } from "../../../../flags";
import { createComputeClient } from "../../../../client";
import { getOrPromptAppID, confirm } from "../../../../utils/prompts";
import chalk from "chalk";
import { isAddress } from "viem";

export default class TeamGrantAdminExecute extends Command {
  static description = "Execute a previously scheduled grantTeamRole(ADMIN) operation once the Timelock delay has elapsed";

  static args = {
    address: Args.string({
      description: "Address to grant the ADMIN role to (must match the scheduled operation)",
      required: true,
    }),
  };

  static flags = {
    ...commonFlags,
    app: Flags.string({
      required: false,
      description: "App ID (used to look up the team owner)",
      env: "ECLOUD_APP_ID",
    }),
    timelock: Flags.string({
      required: true,
      description: "Timelock contract address that owns the app",
      env: "ECLOUD_TIMELOCK_ADDRESS",
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(TeamGrantAdminExecute);
      const compute = await createComputeClient(flags);

      const environment = flags.environment;
      const environmentConfig = getEnvironmentConfig(environment);
      const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;
      const privateKey = flags["private-key"]!;

      const account = args.address;
      if (!isAddress(account)) this.error(`Invalid address: ${account}`);

      const timelockAddress = flags.timelock;
      if (!isAddress(timelockAddress)) this.error(`Invalid timelock address: ${timelockAddress}`);

      const appId = await getOrPromptAppID({ appID: flags.app, environment, privateKey, rpcUrl, action: "execute grant ADMIN" });

      const timelocked = await compute.app.isTimelocked(appId);
      if (!timelocked) {
        this.error("This app is not timelocked. Use 'ecloud compute team grant' for direct role grants.");
      }

      const readyAt = await compute.app.getTimelockGrantAdminReadyAt(appId, timelockAddress, account);

      if (readyAt === 0n) {
        this.error("No ADMIN grant is scheduled for this address. Run 'ecloud compute team grant-admin schedule' first.");
      }

      const now = BigInt(Math.floor(Date.now() / 1000));
      if (now < readyAt) {
        const remaining = readyAt - now;
        const readyDate = new Date(Number(readyAt) * 1000).toLocaleString();
        this.error(`ADMIN grant is not ready yet. Executable after ${chalk.bold(readyDate)} (${remaining}s remaining).`);
      }

      const readyDate = new Date(Number(readyAt) * 1000).toLocaleString();
      this.log(`\nApp:       ${chalk.bold(appId)}`);
      this.log(`Timelock:  ${chalk.bold(timelockAddress)}`);
      this.log(`Grant:     ${chalk.bold("ADMIN")} → ${chalk.bold(account)}`);
      this.log(`Scheduled: ${chalk.bold(readyDate)}`);

      if (isMainnet(environmentConfig)) {
        const confirmed = await confirm("Execute ADMIN grant?");
        if (!confirmed) {
          this.log(`\n${chalk.gray("Execution cancelled")}`);
          return;
        }
      }

      const { tx } = await compute.app.executeTimelockGrantAdmin(appId, timelockAddress, account, {});

      this.log(`\n✅ ${chalk.green(`ADMIN role granted to ${account} (tx: ${tx})`)}`);
    });
  }
}
