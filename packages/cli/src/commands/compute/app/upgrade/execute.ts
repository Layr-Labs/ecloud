// [DEMO STUB] Network and build calls replaced with simulated output for UX review.
// Real implementation: taras/gov branch.
//
// Error scenario overrides (ECLOUD_DEMO_SCENARIO):
//   not-ready   — delay hasn't elapsed yet
//   mismatch    — release hash doesn't match
import { Command, Args, Flags } from "@oclif/core";
import { commonFlags } from "../../../../flags";
import chalk from "chalk";
import { getDemoState, setDemoState, isTimelockOverSafe, getSafeAddress } from "../../../../utils/demoState";

const DEMO_TX = "0x9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f9e8";
const DEMO_DIGEST = "sha256:6da6226e847082ed23ac90bd65ff4710171006249ad4e0a12d2ab19be4210dae";

function demoDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default class AppUpgradeExecute extends Command {
  static description =
    "Execute a previously scheduled upgrade for a timelocked app once the delay has elapsed";

  static args = {
    "app-id": Args.string({
      description: "App ID or name",
      required: false,
    }),
  };

  static flags = {
    ...commonFlags,
    dockerfile: Flags.string({
      required: false,
      description: "Path to Dockerfile (must match what was used in schedule)",
      env: "ECLOUD_DOCKERFILE_PATH",
    }),
    "image-ref": Flags.string({
      required: false,
      description: "Image reference (must match what was used in schedule)",
      env: "ECLOUD_IMAGE_REF",
    }),
    "env-file": Flags.string({
      required: false,
      description: "Environment file (must match what was used in schedule)",
      default: ".env",
      env: "ECLOUD_ENVFILE_PATH",
    }),
    "instance-type": Flags.string({
      required: false,
      description: "Machine instance type",
      env: "ECLOUD_INSTANCE_TYPE",
    }),
    "log-visibility": Flags.string({
      required: false,
      description: "Log visibility setting: public, private, or off",
      options: ["public", "private", "off"],
      env: "ECLOUD_LOG_VISIBILITY",
    }),
    "resource-usage-monitoring": Flags.string({
      required: false,
      description: "Resource usage monitoring: enable or disable",
      options: ["enable", "disable"],
      env: "ECLOUD_RESOURCE_USAGE_MONITORING",
    }),
  };

  async run() {
    const { args, flags } = await this.parse(AppUpgradeExecute);
    const scenario = process.env.ECLOUD_DEMO_SCENARIO;

    // 1. Check identity
    const state = getDemoState();
    const { identity, pendingSchedule, app: demoApp } = state;

    if (!demoApp) {
      this.error("No app deployed yet. Run 'ecloud compute app deploy' first.");
    }

    if (!identity || identity.type !== "timelock") {
      const hint = !identity
        ? "Run 'ecloud auth login' first and select a Timelock identity."
        : identity.type === "safe"
          ? "You are logged in as a Safe — use 'ecloud compute app upgrade' for direct upgrades."
          : "You are logged in as an EOA — use 'ecloud compute app upgrade' for direct upgrades.";
      this.error(`This app is not timelocked. ${hint}`);
    }

    // 2. Check pending schedule
    if (!pendingSchedule) {
      this.error(
        "No upgrade is scheduled for this app. Run 'ecloud compute app upgrade schedule' first.",
      );
    }

    const appID = args["app-id"] || pendingSchedule.appId;
    const imageRef = flags["image-ref"] || flags.dockerfile || pendingSchedule.imageRef;

    // 3. Real clock check — show "not ready" if delay hasn't elapsed
    const now = Math.floor(Date.now() / 1000);
    if (scenario === "not-ready" || now < pendingSchedule.readyAt) {
      const remaining = pendingSchedule.readyAt - now;
      const readyDate = new Date(pendingSchedule.readyAt * 1000).toLocaleString();
      this.error(
        `Upgrade is not ready yet. Executable after ${chalk.bold(readyDate)} (${remaining}s remaining).`,
      );
    }

    if (scenario === "mismatch") {
      this.error(
        "contract error: ReleaseMismatch\n" +
          "The provided build inputs do not match what was committed during 'upgrade schedule'.\n" +
          "Re-run with the exact same --image-ref, --env-file, and --instance-type.",
      );
    }

    // 4. Happy path
    this.log(chalk.cyan("\nScheduled upgrade is ready. Proceeding with execution..."));

    this.log(chalk.gray("\nRebuilding image for verification..."));
    await demoDelay(700);
    this.log(chalk.gray(`  ✓ Image verified: ${imageRef}@${DEMO_DIGEST.slice(0, 23)}...`));
    await demoDelay(300);
    this.log(chalk.gray("  ✓ Release hash matched"));
    await demoDelay(600);

    // 5. Timelock(Safe): each step needs Safe approval
    if (isTimelockOverSafe(identity)) {
      const safeAddr = getSafeAddress(identity)!;
      this.log(chalk.cyan(`\nTransaction proposed to Safe for execution. (${safeAddr.slice(0, 6)}...${safeAddr.slice(-4)})`));
      this.log(
        `${chalk.gray("View and sign at:")} ${chalk.blue.underline(`https://app.safe.global/transactions/queue?safe=eth:${safeAddr}`)}`,
      );
      this.log(chalk.gray("\n(Simulating Safe approval...)"));
      await demoDelay(1200);
    }

    // 6. Clear pending schedule and record new image in state
    const updatedApp = state.app ? { ...state.app, image: imageRef, lastUpgradeAt: Math.floor(Date.now() / 1000) } : undefined;
    setDemoState({ ...state, pendingSchedule: undefined, app: updatedApp });

    this.log(
      `\n✅ ${chalk.green(`App upgraded successfully ${chalk.bold(`(id: ${appID}, image: ${imageRef})`)}` )}`,
    );
    this.log(`\n${chalk.gray("tx:")} ${chalk.gray(DEMO_TX)}`);
    this.log(
      `\n${chalk.gray("View your app:")} ${chalk.blue.underline(`https://app.eigencloud.xyz/apps/${appID}`)}`,
    );
  }
}
