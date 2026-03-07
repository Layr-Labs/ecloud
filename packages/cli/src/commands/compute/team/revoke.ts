// [DEMO STUB] Revoke a team role from an address.
import { Command, Args } from "@oclif/core";
import { select } from "@inquirer/prompts";
import { commonFlags } from "../../../flags";
import chalk from "chalk";
import { getDemoState, isTimelockOverSafe, getSafeAddress } from "../../../utils/demoState";

// Demo: the address has these roles by default
const DEMO_ADDRESS_ROLES: Record<string, string[]> = {
  default: ["PAUSER", "DEVELOPER"],
};

export default class TeamRevoke extends Command {
  static description = "Revoke a role from an address on your team";

  static args = {
    address: Args.string({
      description: "Address to revoke the role from",
      required: false,
    }),
  };

  static flags = {
    ...commonFlags,
  };

  async run() {
    const { args } = await this.parse(TeamRevoke);

    const address = args.address || "0x1234567890abcdef1234567890abcdef12345678";
    const addrShort = address.slice(0, 6) + "..." + address.slice(-4);
    const currentRoles = DEMO_ADDRESS_ROLES[address] ?? DEMO_ADDRESS_ROLES.default;

    this.log(`\n${chalk.bold(addrShort)} has: ${currentRoles.join(", ")}\n`);

    if (currentRoles.length === 0) {
      this.log(chalk.yellow("This address has no roles to revoke."));
      return;
    }

    const role = await select({
      message: "Select role to revoke:",
      choices: currentRoles.map((r) => ({ name: r, value: r })),
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

    this.log(`\n${chalk.green("✓")} Role ${chalk.bold(role)} revoked from ${chalk.bold(addrShort)}`);
  }
}
