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

export default class TeamRevoke extends Command {
  static description = "Revoke a team role (PAUSER or DEVELOPER) from an address";

  static args = {
    address: Args.string({
      description: "Address to revoke the role from",
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
      description: "Role to revoke: PAUSER or DEVELOPER",
      options: ROLE_CHOICES as unknown as string[],
      env: "ECLOUD_TEAM_ROLE",
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(TeamRevoke);
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
        action: "revoke team role",
      });

      const role = TeamRole[flags.role as RoleChoice];

      this.log(`\nApp:     ${chalk.bold(appID)}`);
      this.log(`Revoke:  ${chalk.bold(flags.role)} from ${chalk.bold(account)}`);

      if (isMainnet(environmentConfig)) {
        const confirmed = await confirm("Revoke this role?");
        if (!confirmed) {
          this.log(`\n${chalk.gray("Cancelled")}`);
          return;
        }
      }

      const res = await compute.app.revokeTeamRole(appID, role, account);
      this.log(`\n✅ ${chalk.green(`${flags.role} role revoked from ${account} (tx: ${res.tx})`)}`);
    });
  }
}
