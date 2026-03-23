import { Command, Args } from "@oclif/core";
import { getEnvironmentConfig, isMainnet } from "@layr-labs/ecloud-sdk";
import { withTelemetry } from "../../../../telemetry";
import { commonFlags } from "../../../../flags";
import { createComputeClient } from "../../../../client";
import { createViemClients } from "../../../../utils/viemClients";
import { getOrPromptAppID, confirm } from "../../../../utils/prompts";
import chalk from "chalk";
import { executeGovernedUpgrade } from "@layr-labs/ecloud-sdk";
import { setLinkedAppForDirectory } from "../../../../utils/globalConfig";
import { getDashboardUrl } from "../../../../utils/dashboard";

export default class AppUpgradeExecute extends Command {
  static description = "Execute a previously scheduled upgrade for a timelocked app once the delay has elapsed";

  static args = {
    "app-id": Args.string({
      description: "App ID or name",
      required: false,
    }),
  };

  static flags = { ...commonFlags };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(AppUpgradeExecute);
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
        action: "execute upgrade",
      });

      // Verify timelocked mode
      const timelocked = await compute.app.isTimelocked(appID);
      if (!timelocked) {
        this.error("This app is not timelocked. Use 'ecloud compute app upgrade' for direct upgrades.");
      }

      // Check scheduled upgrade status
      const pending = await compute.app.getPendingUpgrade(appID);
      if (pending.readyAt === 0n) {
        this.error("No upgrade is scheduled for this app. Run 'ecloud compute app upgrade schedule' first.");
      }

      const now = BigInt(Math.floor(Date.now() / 1000));
      if (now < pending.readyAt) {
        const remaining = pending.readyAt - now;
        const readyDate = new Date(Number(pending.readyAt) * 1000).toLocaleString();
        this.error(`Upgrade is not ready yet. Executable after ${chalk.bold(readyDate)} (${remaining}s remaining).`);
      }

      this.log(chalk.cyan(`\nScheduled upgrade is ready. Fetching release from chain...`));

      if (isMainnet(environmentConfig)) {
        const confirmed = await confirm("Execute the scheduled upgrade?");
        if (!confirmed) {
          this.log(`\n${chalk.gray("Execution cancelled")}`);
          return;
        }
      }

      const { walletClient, publicClient } = createViemClients({ privateKey, rpcUrl, environment });

      const res = await executeGovernedUpgrade(
        {
          appId: appID,
          walletClient,
          publicClient,
          environment,
          skipTelemetry: true,
        },
      );

      try {
        const cwd = process.env.INIT_CWD || process.cwd();
        setLinkedAppForDirectory(environment, cwd, res.appId);
      } catch {}

      this.log(
        `\n✅ ${chalk.green(`App upgraded successfully ${chalk.bold(`(id: ${res.appId}, image: ${res.imageRef})`)}`)}`,
      );

      const dashboardUrl = getDashboardUrl(environment, res.appId);
      this.log(`\n${chalk.gray("View your app:")} ${chalk.blue.underline(dashboardUrl)}`);
    });
  }
}
