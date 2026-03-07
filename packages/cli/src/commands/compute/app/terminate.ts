import { Command, Args, Flags } from "@oclif/core";
import { createComputeClient } from "../../../client";
import { commonFlags } from "../../../flags";
import {
  getEnvironmentConfig,
  estimateTransactionGas,
  encodeTerminateAppData,
  isMainnet,
} from "@layr-labs/ecloud-sdk";
import { getOrPromptAppID, confirm } from "../../../utils/prompts";
import { getPrivateKeyInteractive } from "../../../utils/prompts";
import { createViemClients } from "../../../utils/viemClients";
import chalk from "chalk";
import { withTelemetry } from "../../../telemetry";

export default class AppLifecycleTerminate extends Command {
  static description = "Terminate app (terminate GCP instance) permanently";

  static args = {
    "app-id": Args.string({
      description: "App ID or name to terminate",
      required: false,
    }),
  };

  static flags = {
    ...commonFlags,
    force: Flags.boolean({
      required: false,
      description: "Force termination without confirmation",
      default: false,
    }),
  };

  async run() {
    if (process.env.ECLOUD_REAL_MODE !== "true") {
      const { getDemoState, setDemoState, isTimelockOverSafe, getSafeAddress } = await import("../../../utils/demoState");
      const state = getDemoState();
      if (!state.app) { this.error("No app deployed yet. Run 'ecloud compute app deploy' first."); }
      await new Promise((r) => setTimeout(r, 800));
      const { identity } = state;
      if (identity && (identity.type === "safe" || isTimelockOverSafe(identity))) {
        const safeAddr = getSafeAddress(identity)!;
        this.log(chalk.cyan(`\nTransaction proposed to Safe. (${safeAddr.slice(0, 6)}...${safeAddr.slice(-4)})`));
        this.log(`${chalk.gray("View and sign at:")} ${chalk.blue.underline(`https://app.safe.global/transactions/queue?safe=eth:${safeAddr}`)}`);
        this.log(chalk.gray("\n(Simulating Safe approval...)"));
        await new Promise((r) => setTimeout(r, 1200));
      }
      setDemoState({ ...state, app: { ...state.app!, status: "TERMINATED" } });
      this.log(`\n✅ ${chalk.green(`App terminated (id: ${state.app.appId})`)}`);
      return;
    }
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(AppLifecycleTerminate);
      const compute = await createComputeClient(flags);

      // Get environment config (flags already validated by createComputeClient)
      const environment = flags.environment;
      const environmentConfig = getEnvironmentConfig(environment);

      // Get RPC URL (needed for contract queries and authentication)
      const rpcUrl = flags.rpcUrl || environmentConfig.defaultRPCURL;

      // Get private key for gas estimation
      const privateKey = flags["private-key"] || (await getPrivateKeyInteractive(environment));

      // Resolve app ID (prompt if not provided)
      const appId = await getOrPromptAppID({
        appID: args["app-id"],
        environment: flags["environment"]!,
        privateKey,
        rpcUrl,
        action: "terminate",
      });

      // Create viem clients for gas estimation
      const { publicClient, address } = createViemClients({
        privateKey,
        rpcUrl,
        environment,
      });

      // Estimate gas cost
      const callData = encodeTerminateAppData(appId);
      const estimate = await estimateTransactionGas({
        publicClient,
        from: address,
        to: environmentConfig.appControllerAddress,
        data: callData,
      });

      // Ask for confirmation unless forced
      if (!flags.force) {
        const costInfo = isMainnet(environmentConfig)
          ? ` (cost: up to ${estimate.maxCostEth} ETH)`
          : "";
        const confirmed = await confirm(`⚠️  Permanently destroy app ${appId}${costInfo}?`);
        if (!confirmed) {
          this.log(`\n${chalk.gray(`Termination aborted`)}`);
          return;
        }
      }

      const res = await compute.app.terminate(appId, {
        gas: estimate,
      });

      if (!res.tx) {
        this.log(`\n${chalk.gray(`Termination failed`)}`);
      } else {
        this.log(`\n✅ ${chalk.green(`App terminated successfully`)}`);
      }
    });
  }
}
