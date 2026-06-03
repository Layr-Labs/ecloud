import { Command, Args, Flags } from "@oclif/core";
import {
  getEnvironmentConfig,
  isMainnet,
  TeamRole,
  encodeRevokeTeamRoleData,
  getAppOwner,
} from "@layr-labs/ecloud-sdk";
import { withTelemetry } from "../../../telemetry";
import { commonFlags, timelockFlags } from "../../../flags";
import { createComputeClient } from "../../../client";
import { getOrPromptAppID, getPrivateKeyInteractive, confirm } from "../../../utils/prompts";
import { createViemClients } from "../../../utils/viemClients";
import { printIdentityContext, executeWithIdentity, printTransactionResult } from "../../../utils/identityTransaction";
import { handleTimelockExecute, handleTimelockCancel } from "../../../utils/timelockExecute";
import { isAddress } from "viem";
import type { Address } from "viem";
import chalk from "chalk";

const ROLE_CHOICES = ["PAUSER", "DEVELOPER"] as const;
type RoleChoice = (typeof ROLE_CHOICES)[number];

export default class TeamRevoke extends Command {
  static description = "Revoke a team role (PAUSER or DEVELOPER) from an address";

  static args = {
    address: Args.string({
      description: "Address to revoke the role from",
      required: false,
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
      required: false,
      description: "Role to revoke: PAUSER or DEVELOPER",
      options: ROLE_CHOICES as unknown as string[],
      env: "ECLOUD_TEAM_ROLE",
    }),
    force: Flags.boolean({
      description: "Skip all confirmation prompts",
      default: false,
    }),
    ...timelockFlags,
  };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(TeamRevoke);

      const environment = flags.environment;
      const environmentConfig = getEnvironmentConfig(environment);
      const rpcUrl = flags["rpc-url"] || environmentConfig.defaultRPCURL;
      const privateKey = await getPrivateKeyInteractive(flags["private-key"]);

      if (flags.execute) {
        await handleTimelockExecute({ opId: flags.execute, environment, privateKey, rpcUrl, log: this.log.bind(this), error: this.error.bind(this) });
        return;
      }
      if (flags.cancel) {
        await handleTimelockCancel({ opId: flags.cancel, environment, privateKey, rpcUrl, log: this.log.bind(this), error: this.error.bind(this) });
        return;
      }

      if (!flags.role) {
        this.error("--role is required when not using --execute");
      }

      const account = args.address;
      if (!account) {
        this.error("ADDRESS argument is required when not using --execute or --cancel");
      }
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

      const { publicClient, walletClient, address } = createViemClients({
        privateKey,
        rpcUrl,
        environment,
      });

      const identity = printIdentityContext(environment, address, this.log.bind(this));

      if ((isMainnet(environmentConfig) || identity.type !== "eoa") && !flags.force) {
        const confirmed = await confirm(`Revoke ${flags.role} role?`);
        if (!confirmed) {
          this.log(`\n${chalk.gray("Cancelled")}`);
          return;
        }
      }

      if (identity.type === "eoa") {
        const compute = await createComputeClient(flags);
        const res = await compute.app.revokeTeamRole(appID, role, account);
        this.log(`\n✅ ${chalk.green(`${flags.role} role revoked from ${account} (tx: ${res.tx})`)}`);
      } else {
        const team = await getAppOwner(publicClient, environmentConfig, appID as Address);
        const callData = encodeRevokeTeamRoleData(team, role, account as Address);
        const finalTx = undefined; // skip gas estimation — msg.sender will be Safe/Timelock, not EOA

        const result = await executeWithIdentity({
          environment,
          eoaAddress: address,
          walletClient,
          publicClient,
          environmentConfig,
          to: environmentConfig.appControllerAddress as Address,
          data: callData,
          pendingMessage: `Revoking ${flags.role} role from ${account}...`,
          txDescription: "RevokeTeamRole",
          gas: finalTx,
          delayOverride: flags.delay,
        });

        this.log("");
        printTransactionResult(result, this.log.bind(this));
        if (result.type === "direct") {
          this.log(`\n✅ ${chalk.green(`${flags.role} role revoked from ${account}`)}`);
        }
      }
    });
  }
}
