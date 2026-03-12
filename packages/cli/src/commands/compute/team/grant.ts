import { Command, Args, Flags } from "@oclif/core";
import { getEnvironmentConfig, isMainnet, TeamRole } from "@layr-labs/ecloud-sdk";
import { withTelemetry } from "../../../telemetry";
import { commonFlags } from "../../../flags";
import { createComputeClient } from "../../../client";
import { getOrPromptAppID, confirm } from "../../../utils/prompts";
import { isAddress } from "viem";
import chalk from "chalk";

const ROLE_CHOICES = ["PAUSER", "DEVELOPER"] as const;
type RoleChoice = (typeof ROLE_CHOICES)[number];

export default class TeamGrant extends Command {
  static description = "Grant a team role (PAUSER or DEVELOPER) to an address for an app's team";

  static args = {
    address: Args.string({
      description: "Address to grant the role to",
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
    role: Flags.string({
      required: true,
      description: "Role to grant: PAUSER or DEVELOPER",
      options: ROLE_CHOICES as unknown as string[],
      env: "ECLOUD_TEAM_ROLE",
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(TeamGrant);
      const compute = await createComputeClient(flags);

      const environment = flags.environment;
      const environmentConfig = getEnvironmentConfig(environment);
      const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;
      const privateKey = flags["private-key"]!;

      const account = args.address;
      if (!isAddress(account)) {
        this.error(`Invalid address: ${account}`);
      }

      const appID = await getOrPromptAppID({
        appID: flags.app,
        environment,
        privateKey,
        rpcUrl,
        action: "grant team role",
      });

      const role = TeamRole[flags.role as RoleChoice];

      this.log(`\nApp:     ${chalk.bold(appID)}`);
      this.log(`Grant:   ${chalk.bold(flags.role)} → ${chalk.bold(account)}`);

      if (isMainnet(environmentConfig)) {
        const confirmed = await confirm("Grant this role?");
        if (!confirmed) {
          this.log(`\n${chalk.gray("Cancelled")}`);
          return;
        }
      }

      const res = await compute.app.grantTeamRole(appID, role, account);
      this.log(`\n✅ ${chalk.green(`${flags.role} role granted to ${account} (tx: ${res.tx})`)}`);
    });
  }
}
