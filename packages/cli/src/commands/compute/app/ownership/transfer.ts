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

    const { getDemoState, setDemoState, isTimelockOverSafe, getSafeAddress, DEMO_IDENTITIES, formatIdentity } = await import("../../../../utils/demoState");
    const state = getDemoState();
    const appId = args["app-id"] || state.app?.appId || "0xA1B2C3D4E5F6000000000000000000000000abcd";
    const newOwnerAddr = flags.to;

    // Detect new owner type from known demo identities
    const newOwnerIdentity = DEMO_IDENTITIES.find(
      (id) => id.address.toLowerCase() === newOwnerAddr.toLowerCase(),
    );

    const currentOwner = state.app?.owner || state.identity;
    const currentOwnerDisplay = currentOwner ? formatIdentity(currentOwner) : chalk.gray("(unknown)");
    const newOwnerDisplay = newOwnerIdentity
      ? formatIdentity(newOwnerIdentity)
      : `${newOwnerAddr.slice(0, 6)}...${newOwnerAddr.slice(-4)}`;

    this.log(`\nApp:           ${chalk.bold(state.app?.name || appId)}`);
    this.log(`Current owner: ${chalk.bold(currentOwnerDisplay)}`);
    this.log(`New owner:     ${chalk.bold(newOwnerDisplay)}`);

    await demoDelay(800);

    // Safe simulation if current identity requires it
    const { identity } = state;
    if (identity && (identity.type === "safe" || isTimelockOverSafe(identity))) {
      const safeAddr = getSafeAddress(identity)!;
      this.log(chalk.cyan(`\nTransaction proposed to Safe. (${safeAddr.slice(0, 6)}...${safeAddr.slice(-4)})`));
      this.log(`${chalk.gray("View and sign at:")} ${chalk.blue.underline(`https://app.safe.global/transactions/queue?safe=eth:${safeAddr}`)}`);
      this.log(chalk.gray("\n(Simulating Safe approval...)"));
      await demoDelay(1200);
    }

    // Update app state with new owner
    const isTimelock = newOwnerIdentity?.type === "timelock";
    if (state.app) {
      setDemoState({
        ...state,
        app: {
          ...state.app,
          owner: newOwnerIdentity,
          timelocked: isTimelock,
        },
      });
    }

    this.log(`\n✅ ${chalk.green(`Ownership transferred (tx: ${DEMO_TX})`)}`);

    // Post-transfer hint — specific to new owner type
    if (newOwnerIdentity?.type === "timelock" && isTimelockOverSafe(newOwnerIdentity)) {
      // Timelock(Safe)
      this.log(chalk.cyan("\nTimelocked mode enabled. Direct upgrade is now blocked."));
      this.log(chalk.cyan("Each step also requires Safe approval:"));
      this.log(chalk.cyan(`  ecloud compute app upgrade schedule ${appId} --after=<delay>   → Safe propose → scheduled`));
      this.log(chalk.cyan(`  ecloud compute app upgrade execute  ${appId}                   → Safe propose → done`));
    } else if (newOwnerIdentity?.type === "timelock") {
      // Timelock(EOA)
      this.log(chalk.cyan("\nTimelocked mode enabled. Direct upgrade is now blocked."));
      this.log(chalk.cyan(`  ecloud compute app upgrade schedule ${appId} --after=<delay>`));
      this.log(chalk.cyan(`  ecloud compute app upgrade execute  ${appId}`));
    } else if (newOwnerIdentity?.type === "safe") {
      // Safe
      this.log(chalk.cyan("\nAdmin operations now require Safe threshold approval:"));
      this.log(chalk.cyan("  ecloud compute app upgrade     → Safe propose → threshold → executed"));
      this.log(chalk.cyan("  ecloud compute app stop        → Safe propose → threshold → executed"));
      this.log(chalk.cyan("  ecloud compute app terminate   → Safe propose → threshold → executed"));
    }
  }
}
