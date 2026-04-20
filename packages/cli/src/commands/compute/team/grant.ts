import { Command, Args, Flags } from "@oclif/core";
import {
  getEnvironmentConfig,
  isMainnet,
  TeamRole,
  estimateTransactionGas,
  encodeGrantTeamRoleData,
  getAppOwner,
} from "@layr-labs/ecloud-sdk";
import { withTelemetry } from "../../../telemetry";
import { commonFlags, timelockFlags, applyTxOverrides } from "../../../flags";
import { createComputeClient } from "../../../client";
import { getOrPromptAppID, getPrivateKeyInteractive, confirm } from "../../../utils/prompts";
import { createViemClients } from "../../../utils/viemClients";
import { printIdentityContext, executeWithIdentity, printTransactionResult } from "../../../utils/identityTransaction";
import { handleTimelockExecute, handleTimelockCancel } from "../../../utils/timelockExecute";
import { isAddress } from "viem";
import type { Address } from "viem";
import chalk from "chalk";

const ROLE_CHOICES = ["ADMIN", "PAUSER", "DEVELOPER"] as const;
type RoleChoice = (typeof ROLE_CHOICES)[number];

export default class TeamGrant extends Command {
  static description = "Grant a team role (ADMIN, PAUSER, or DEVELOPER) to an address for an app's team";

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
      required: false,
      description: "Role to grant: ADMIN, PAUSER, or DEVELOPER",
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
      const { args, flags } = await this.parse(TeamGrant);

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

      const { publicClient, walletClient, address } = createViemClients({
        privateKey,
        rpcUrl,
        environment,
      });

      const identity = printIdentityContext(environment, address, this.log.bind(this));

      if ((isMainnet(environmentConfig) || identity.type !== "eoa") && !flags.force) {
        const confirmed = await confirm(`Grant ${flags.role} role?`);
        if (!confirmed) {
          this.log(`\n${chalk.gray("Cancelled")}`);
          return;
        }
      }

      if (identity.type === "eoa") {
        const compute = await createComputeClient(flags);
        const res = await compute.app.grantTeamRole(appID, role, account);
        this.log(`\n✅ ${chalk.green(`${flags.role} role granted to ${account} (tx: ${res.tx})`)}`);
      } else {
        const team = await getAppOwner(publicClient, environmentConfig, appID as Address);
        const callData = encodeGrantTeamRoleData(team, role, account as Address);
        const estimate = identity.type === "eoa"
          ? await estimateTransactionGas({
              publicClient,
              from: address,
              to: environmentConfig.appControllerAddress,
              data: callData,
            })
          : undefined;
        const finalTx = estimate ? await applyTxOverrides(estimate, flags, { publicClient, address }) : undefined;

        const result = await executeWithIdentity({
          environment,
          eoaAddress: address,
          walletClient,
          publicClient,
          environmentConfig,
          to: environmentConfig.appControllerAddress as Address,
          data: callData,
          pendingMessage: `Granting ${flags.role} role to ${account}...`,
          txDescription: "GrantTeamRole",
          gas: finalTx,
        });

        this.log("");
        printTransactionResult(result, this.log.bind(this));
        if (result.type === "direct") {
          this.log(`\n✅ ${chalk.green(`${flags.role} role granted to ${account}`)}`);
        }
      }
    });
  }
}
