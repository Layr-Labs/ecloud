import { Command, Args, Flags } from "@oclif/core";
import { getEnvironmentConfig, isMainnet } from "@layr-labs/ecloud-sdk";
import { withTelemetry } from "../../../../telemetry";
import { commonFlags } from "../../../../flags";
import { createComputeClient } from "../../../../client";
import { getOrPromptAppID, confirm } from "../../../../utils/prompts";
import { isAddress } from "viem";
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
  };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(AppOwnershipTransfer);
      const compute = await createComputeClient(flags);

      const environment = flags.environment;
      const environmentConfig = getEnvironmentConfig(environment);
      const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;
      const privateKey = flags["private-key"]!;

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

      // Check current governance state
      const governed = await compute.app.isGoverned(appId);

      this.log(`\nApp:       ${chalk.bold(appId)}`);
      this.log(`New owner: ${chalk.bold(newOwner)}`);
      if (!governed) {
        this.log(chalk.yellow("\nNote: if the new owner is a Safe or Timelock deployed by SafeTimelockFactory, governance mode will be enabled automatically."));
      }

      if (isMainnet(environmentConfig)) {
        const confirmed = await confirm("Continue with ownership transfer?");
        if (!confirmed) {
          this.log(`\n${chalk.gray("Transfer cancelled")}`);
          return;
        }
      }

      const res = await compute.app.transferOwnership(appId, newOwner);

      this.log(`\n✅ ${chalk.green(`Ownership transferred successfully (tx: ${res.tx})`)}`);

      // Check whether governance was enabled as a result
      const nowGoverned = await compute.app.isGoverned(appId);
      if (nowGoverned) {
        this.log(chalk.cyan("\nGovernance mode enabled. Upgrades now require:"));
        this.log(chalk.cyan("  ecloud compute app upgrade schedule --app=<id> --after=<duration>"));
        this.log(chalk.cyan("  ecloud compute app upgrade execute  --app=<id>"));
      }
    });
  }
}
