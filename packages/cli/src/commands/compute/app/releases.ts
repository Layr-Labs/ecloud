import { Command, Args } from "@oclif/core";
import { getEnvironmentConfig, UserApiClient, type AppRelease } from "@layr-labs/ecloud-sdk";
import { commonFlags, validateCommonFlags } from "../../../flags";
import { getOrPromptAppID } from "../../../utils/prompts";
import { withTelemetry } from "../../../telemetry";
import { getClientId } from "../../../utils/version";
import chalk from "chalk";
import { formatAppRelease } from "../../../utils/releases";
import { Address } from "viem";

function sortReleasesOldestFirst(releases: AppRelease[]): AppRelease[] {
  const toNum = (v: unknown): number => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
    return 0;
  };
  return [...releases].sort((a, b) => {
    const byBlock = toNum(a.createdAtBlock) - toNum(b.createdAtBlock);
    if (byBlock !== 0) return byBlock;
    return toNum(a.createdAt) - toNum(b.createdAt);
  });
}

function separator(): string {
  return chalk.gray("—".repeat(40));
}

export default class AppReleases extends Command {
  static description =
    "Show app releases (including verifiable build + dependency builds when available)";

  static args = {
    "app-id": Args.string({
      description: "App ID or name",
      required: false,
    }),
  };

  static flags = {
    ...commonFlags,
  };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(AppReleases);

      // Releases endpoint is readable without auth; only require private key if the user needs
      // it for app name resolution.
      const validatedFlags = await validateCommonFlags(flags, { requirePrivateKey: false });

      const environment = validatedFlags.environment || "sepolia";
      const environmentConfig = getEnvironmentConfig(environment);
      const rpcUrl = validatedFlags["rpc-url"] || environmentConfig.defaultRPCURL;
      const privateKey = validatedFlags["private-key"];

      const appID = await getOrPromptAppID({
        appID: args["app-id"],
        environment,
        privateKey,
        rpcUrl,
        action: "view releases for",
      });

      const userApiClient = new UserApiClient(environmentConfig, privateKey, rpcUrl, getClientId());

      const data = await userApiClient.getApp(appID as Address);
      const releases = sortReleasesOldestFirst(data.releases);

      if (releases.length === 0) {
        this.log(`\nNo releases found for app ${chalk.gray(appID)}`);
        return;
      }

      this.log(`\nReleases for app ${chalk.gray(appID)}:\n`);

      for (let i = 0; i < releases.length; i++) {
        const lines = formatAppRelease(releases[i]!, i);
        for (const line of lines) this.log(line);
        if (i !== releases.length - 1) this.log(`\n${separator()}\n`);
      }
    });
  }
}
