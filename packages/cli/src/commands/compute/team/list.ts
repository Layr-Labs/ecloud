import { Command, Flags } from "@oclif/core";
import { getEnvironmentConfig, TeamRole } from "@layr-labs/ecloud-sdk";
import { withTelemetry } from "../../../telemetry";
import { commonFlags } from "../../../flags";
import { createComputeClient } from "../../../client";
import { getOrPromptAppID } from "../../../utils/prompts";
import chalk from "chalk";

export default class TeamList extends Command {
  static description = "List team role members (ADMIN, PAUSER, DEVELOPER) for an app";

  static flags = {
    ...commonFlags,
    app: Flags.string({
      required: false,
      description: "App ID",
      env: "ECLOUD_APP_ID",
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(TeamList);
      const compute = await createComputeClient(flags);

      const environment = flags.environment;
      const environmentConfig = getEnvironmentConfig(environment);
      const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;
      const privateKey = flags["private-key"]!;

      const appID = await getOrPromptAppID({
        appID: flags.app,
        environment,
        privateKey,
        rpcUrl,
        action: "list team",
      });

      const [admins, pausers, developers] = await Promise.all([
        compute.app.getTeamRoleMembers(appID, TeamRole.ADMIN),
        compute.app.getTeamRoleMembers(appID, TeamRole.PAUSER),
        compute.app.getTeamRoleMembers(appID, TeamRole.DEVELOPER),
      ]);

      this.log(`\nApp: ${chalk.bold(appID)}`);
      this.log("");

      const printRole = (label: string, members: string[]) => {
        this.log(`  ${chalk.bold(label)}`);
        if (members.length === 0) {
          this.log(`    ${chalk.gray("(none)")}`);
        } else {
          for (const m of members) {
            this.log(`    ${m}`);
          }
        }
      };

      printRole("ADMIN", admins);
      printRole("PAUSER", pausers);
      printRole("DEVELOPER", developers);
      this.log("");
    });
  }
}
