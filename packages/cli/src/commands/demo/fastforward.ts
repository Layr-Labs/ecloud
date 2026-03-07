// [DEMO ONLY] Bypasses the timelock delay by setting readyAt to the past.
import { Command } from "@oclif/core";
import { getDemoState, setDemoState } from "../../utils/demoState";
import chalk from "chalk";

export default class DemoFastforward extends Command {
  static description = "[Demo only] Fast-forward the pending timelock delay so upgrade execute runs immediately";

  static aliases = ["demo:ff"];

  async run() {
    const state = getDemoState();

    if (!state.pendingSchedule) {
      this.error("No pending upgrade schedule found. Run 'ecloud compute app upgrade schedule' first.");
    }

    const { pendingSchedule } = state;
    const readyDate = new Date(pendingSchedule.readyAt * 1000).toLocaleString();
    const now = Math.floor(Date.now() / 1000);

    if (now >= pendingSchedule.readyAt) {
      this.log(chalk.yellow(`\nSchedule is already ready (was due ${readyDate}).`));
      return;
    }

    const remaining = pendingSchedule.readyAt - now;
    setDemoState({
      ...state,
      pendingSchedule: { ...pendingSchedule, readyAt: now - 1 },
    });

    this.log(chalk.cyan(`\n⏩ Fast-forwarded ${remaining}s — delay elapsed.`));
    this.log(chalk.gray(`   Original ready time: ${readyDate}`));
    this.log(chalk.gray(`\nRun now: ecloud compute app upgrade execute ${pendingSchedule.appId} --image-ref=${pendingSchedule.imageRef}`));
  }
}
