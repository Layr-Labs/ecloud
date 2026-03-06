// [DEMO STUB] List all team roles.
import { Command } from "@oclif/core";
import { commonFlags } from "../../../flags";
import chalk from "chalk";
import { DEMO_TEAM, formatIdentity } from "../../../utils/demoState";

export default class TeamList extends Command {
  static description = "List all team role assignments";

  static flags = {
    ...commonFlags,
  };

  async run() {
    this.log("\nTeam Roles:\n");

    const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));

    for (const [role, members] of Object.entries(DEMO_TEAM)) {
      members.forEach((m, i) => {
        const label = formatIdentity(m);
        if (i === 0) {
          this.log(`  ${chalk.bold(pad(role + ":", 12))} ${label}`);
        } else {
          this.log(`  ${" ".repeat(12)} ${label}`);
        }
      });
    }

    this.log("");
  }
}
