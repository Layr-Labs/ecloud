// [DEMO STUB] Network calls replaced with simulated output for UX review.
// Real implementation: taras/gov branch.
import { Command, Args, Flags } from "@oclif/core";
import { commonFlags } from "../../../../flags";
import chalk from "chalk";

const DEMO_TX = "0xf3a2b4c8d9e1f05a6789abcdef01234567890abcdef01234567890abcdef0124";

function demoDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default class AppOwnershipTransfer extends Command {
  static description = "Transfer ownership of an app to a new address (Safe or Timelock enables timelocked mode)";

  static args = {
    "app-id": Args.string({
      description: "App ID or name",
      required: false,
    }),
  };

  static flags = {
    ...commonFlags,
    to: Flags.string({
      required: true,
      description: "New owner address (Timelock address enables timelocked mode)",
      env: "ECLOUD_NEW_OWNER",
    }),
  };

  async run() {
    const { args, flags } = await this.parse(AppOwnershipTransfer);

    const appId = args["app-id"] || "0xA1B2C3D4E5F6000000000000000000000000abcd";
    const newOwner = flags.to;

    this.log(`\nApp:       ${chalk.bold(appId)}`);
    this.log(`New owner: ${chalk.bold(newOwner)}`);
    this.log(
      chalk.yellow(
        "\nNote: if the new owner is a Timelock deployed by SafeTimelockFactory, timelocked mode will be enabled automatically.",
      ),
    );

    await demoDelay(1200);

    this.log(`\n✅ ${chalk.green(`Ownership transferred successfully (tx: ${DEMO_TX})`)}`);

    // Timelocked mode is enabled when the new owner is a Timelock.
    // In this demo it is always shown — adjust ECLOUD_DEMO_NO_TIMELOCK=true to suppress.
    const suppressTimelock = process.env.ECLOUD_DEMO_NO_TIMELOCK === "true";
    if (!suppressTimelock) {
      this.log(chalk.cyan("\nTimelocked mode enabled. Upgrades now require:"));
      this.log(chalk.cyan(`  ecloud compute app upgrade schedule --app=${appId} --after=<duration>`));
      this.log(chalk.cyan(`  ecloud compute app upgrade execute  --app=${appId}`));
    }
  }
}
