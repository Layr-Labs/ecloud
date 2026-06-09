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

    // One-shot read first. --wait only blocks while the app is still
    // transitioning; a settled status (Running/Stopped/Terminated/Failed/...)
    // returns immediately instead of polling until the watch timeout.
    const initialStatus = await this.readStatus(userApiClient, appID);

    if (flags.wait && isTransitionalStatus(initialStatus)) {
      // Reuse the bounded watch machinery: polls server-side at a
      // fixed cadence with 429/5xx backoff, throws WatchTimeoutError on timeout.
      // In --json mode, route SDK progress to stderr so stdout stays pure JSON.
      const compute = await createComputeClient(
        validatedFlags,
        flags.json ? { logger: stderrLogger } : {},
      );
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

      // Final read after waiting; the status has (hopefully) settled.
      const finalStatus = await this.readStatus(userApiClient, appID);
      this.emit(appID, finalStatus, flags.json);
      return;
    }

    this.emit(appID, initialStatus, flags.json);
  }

  /** Fetch the current status for an app, defaulting to "Unknown". */
  private async readStatus(userApiClient: UserApiClient, appID: string): Promise<string> {
    const statuses = await userApiClient.getStatuses([appID]);
    return statuses[0]?.status || "Unknown";
  }

  /** Write the status as JSON (machine-readable) or a formatted line. */
  private emit(appID: string, status: string, json: boolean): void {
    if (json) {
      this.log(JSON.stringify({ appId: appID, status }));
      return;
    }
    this.log(`${chalk.bold(appID)}: ${formatStatus(status)}`);
  }
}

/**
 * Statuses that represent an in-progress transition the orchestrator will move
 * out of on its own. Only these are worth blocking on with --wait; any other
 * (settled) status returns immediately. Compared case-insensitively so a casing
 * change on the server side doesn't silently turn --wait into a no-op.
 */
const TRANSITIONAL_STATUSES = new Set([
  "created",
  "deploying",
  "upgrading",
  "resuming",
  "stopping",
  "terminating",
]);

function isTransitionalStatus(status: string): boolean {
  return TRANSITIONAL_STATUSES.has(status.toLowerCase());
}

/**
 * Logger that routes every level to stderr. Used in --json mode so SDK
 * progress output ("Waiting for app to start...", "Status: ...") never
 * pollutes the JSON object on stdout.
 */
const stderrLogger = {
  debug: (...args: unknown[]) => console.error(...args),
  info: (...args: unknown[]) => console.error(...args),
  warn: (...args: unknown[]) => console.error(...args),
  error: (...args: unknown[]) => console.error(...args),
};

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
