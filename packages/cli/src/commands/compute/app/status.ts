import { Command, Args, Flags } from "@oclif/core";
import { getEnvironmentConfig, UserApiClient, WatchTimeoutError } from "@layr-labs/ecloud-sdk";
import { commonFlags, validateCommonFlags } from "../../../flags";
import { getOrPromptAppID } from "../../../utils/prompts";
import { getClientId } from "../../../utils/version";
import { createComputeClient } from "../../../client";
import { createViemClients } from "../../../utils/viemClients";
import chalk from "chalk";

export default class AppStatus extends Command {
  static description =
    "Show an app's current status. Use --wait to block until it settles instead of polling `app info` in a loop.";

  static examples = [
    "<%= config.bin %> compute app status 0xabc...",
    "<%= config.bin %> compute app status 0xabc... --json",
    "<%= config.bin %> compute app status 0xabc... --wait",
    "ECLOUD_WATCH_TIMEOUT_SECONDS=120 <%= config.bin %> compute app status 0xabc... --wait",
  ];

  static args = {
    "app-id": Args.string({
      description: "App ID or name (env: ECLOUD_APP_ID)",
      required: false,
    }),
  };

  static flags = {
    ...commonFlags,
    wait: Flags.boolean({
      description:
        "Block until the app reaches a terminal status (Running/Stopped) or the watch timeout elapses, instead of returning immediately",
      default: false,
    }),
    "watch-timeout": Flags.integer({
      description:
        "With --wait: maximum seconds to wait before returning a recovery hint (default: 600)",
      env: "ECLOUD_WATCH_TIMEOUT_SECONDS",
    }),
    json: Flags.boolean({
      description: "Output machine-readable JSON ({ appId, status })",
      default: false,
    }),
  };

  async run() {
    const { args, flags } = await this.parse(AppStatus);

    const validatedFlags = await validateCommonFlags(flags);
    const environment = validatedFlags.environment;
    const environmentConfig = getEnvironmentConfig(environment);
    const rpcUrl = validatedFlags["rpc-url"] || environmentConfig.defaultRPCURL;
    const privateKey = validatedFlags["private-key"]!;

    const appID = await getOrPromptAppID({
      appID: args["app-id"] ?? process.env.ECLOUD_APP_ID,
      environment,
      privateKey,
      rpcUrl,
      action: "check status of",
    });

    const { publicClient, walletClient } = createViemClients({
      privateKey,
      rpcUrl,
      environment,
    });
    const userApiClient = new UserApiClient(environmentConfig, walletClient, publicClient, {
      clientId: getClientId(),
    });

    if (flags.wait) {
      // Reuse the bounded watch machinery: polls server-side at a
      // fixed cadence with 429/5xx backoff, throws WatchTimeoutError on timeout.
      const compute = await createComputeClient(validatedFlags);
      try {
        await compute.app.watchDeployment(appID, {
          timeoutSeconds: flags["watch-timeout"],
        });
      } catch (err) {
        if (err instanceof WatchTimeoutError) {
          // Fall through to a final one-shot read + hint below rather than crash.
          if (!flags.json) {
            this.warn(
              `Timed out after ${err.elapsedSeconds}s waiting for ${appID}. ` +
                `Check 'ecloud compute app info ${appID}' or the orchestrator logs.`,
            );
          }
        } else {
          throw err;
        }
      }
    }

    // One-shot status read (also the final read after --wait).
    const statuses = await userApiClient.getStatuses([appID]);
    const status = statuses[0]?.status || "Unknown";

    if (flags.json) {
      this.log(JSON.stringify({ appId: appID, status }));
      return;
    }

    this.log(`${chalk.bold(appID)}: ${formatStatus(status)}`);
  }
}

function formatStatus(status: string): string {
  switch (status.toLowerCase()) {
    case "running":
    case "started":
      return chalk.green(status);
    case "failed":
    case "terminated":
      return chalk.red(status);
    case "stopped":
    case "suspended":
      return chalk.yellow(status);
    default:
      return status;
  }
}
