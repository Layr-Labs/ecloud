// [DEMO STUB] Grant a team role to an address.
import { Command, Args } from "@oclif/core";
import { select } from "@inquirer/prompts";
import { commonFlags } from "../../../flags";
import chalk from "chalk";
import { getDemoState, isTimelockOverSafe, getSafeAddress } from "../../../utils/demoState";

const ROLES = [
  {
    value: "ADMIN",
    name: "ADMIN     — Full access: create apps, upgrade, start, stop, terminate, manage roles",
  },
  {
    value: "PAUSER",
    name: "PAUSER    — Stop apps (emergency response)",
  },
  {
    value: "DEVELOPER",
    name: "DEVELOPER — Update metadata, view logs, submit builds",
  },
];

export default class TeamGrant extends Command {
  static description = "Grant a role to an address on your team";

  static args = {
    address: Args.string({
      description: "Address to grant the role to",
      required: false,
    }),
  };

  static flags = {
    ...commonFlags,
  };

  async run() {
    const { args } = await this.parse(TeamGrant);

    const address = args.address || "0x1234567890abcdef1234567890abcdef12345678";
    const addrShort = address.slice(0, 6) + "..." + address.slice(-4);

    this.log(`\nGranting role to ${chalk.bold(addrShort)}\n`);

    const role = await select({
      message: "Select role to grant:",
      choices: ROLES,
    });

    await new Promise((r) => setTimeout(r, 600));

    const { identity } = getDemoState();
    if (identity && (identity.type === "safe" || isTimelockOverSafe(identity))) {
      const safeAddr = getSafeAddress(identity)!;
      this.log(chalk.cyan(`\nTransaction proposed to Safe. (${safeAddr.slice(0, 6)}...${safeAddr.slice(-4)})`));
      this.log(
        `${chalk.gray("View and sign at:")} ${chalk.blue.underline(`https://app.safe.global/transactions/queue?safe=eth:${safeAddr}`)}`,
      );
      this.log(chalk.gray("\n(Simulating Safe approval...)"));
      await new Promise((r) => setTimeout(r, 1200));
    }

    this.log(`\n${chalk.green("✓")} Role ${chalk.bold(role)} granted to ${chalk.bold(addrShort)}`);
  }
}
