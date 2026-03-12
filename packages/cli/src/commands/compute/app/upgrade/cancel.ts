import { Command, Args } from "@oclif/core";
import { getEnvironmentConfig, isMainnet } from "@layr-labs/ecloud-sdk";
import { withTelemetry } from "../../../../telemetry";
import { commonFlags } from "../../../../flags";
import { createComputeClient } from "../../../../client";
import { getOrPromptAppID, confirm } from "../../../../utils/prompts";
import chalk from "chalk";

export default class AppUpgradeCancel extends Command {
  static description = "Cancel a pending scheduled upgrade for a timelocked app";

  static args = {
    "app-id": Args.string({
      description: "App ID",
      required: false,
    }),
  };

  static flags = { ...commonFlags };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(AppUpgradeCancel);
      const compute = await createComputeClient(flags);

      const environment = flags.environment;
      const environmentConfig = getEnvironmentConfig(environment);
      const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;
      const privateKey = flags["private-key"]!;

      const appID = await getOrPromptAppID({
        appID: args["app-id"],
        environment,
        privateKey,
        rpcUrl,
        action: "cancel upgrade",
      });

      const timelocked = await compute.app.isTimelocked(appID);
      if (!timelocked) {
        this.error("This app is not timelocked. Only timelocked apps have scheduled upgrades.");
      }

      const pending = await compute.app.getPendingUpgrade(appID);
      if (pending.readyAt === 0n) {
        this.error("No upgrade is scheduled for this app.");
      }

      const readyDate = new Date(Number(pending.readyAt) * 1000).toLocaleString();
      this.log(`\nApp:       ${chalk.bold(appID)}`);
      this.log(`Scheduled: ${chalk.bold(readyDate)}`);

      if (isMainnet(environmentConfig)) {
        const confirmed = await confirm("Cancel this scheduled upgrade?");
        if (!confirmed) {
          this.log(`\n${chalk.gray("Cancellation aborted")}`);
          return;
        }
      }

      const res = await compute.app.cancelUpgrade(appID);
      this.log(`\n✅ ${chalk.green(`Scheduled upgrade cancelled (tx: ${res.tx})`)}`);
    });
  }
}
