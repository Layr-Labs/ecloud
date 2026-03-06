// [DEMO STUB] Network and build calls replaced with simulated output for UX review.
// Real implementation: taras/gov branch.
//
// Demo scenarios (set via env var ECLOUD_DEMO_SCENARIO):
//   (default)   — upgrade is ready, executes successfully
//   not-ready   — delay hasn't elapsed yet
//   no-schedule — no pending upgrade exists
//   mismatch    — release hash doesn't match what was scheduled
import { Command, Args, Flags } from "@oclif/core";
import { commonFlags } from "../../../../flags";
import chalk from "chalk";

const DEMO_TX = "0x9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f9e8";
const DEMO_DIGEST = "sha256:6da6226e847082ed23ac90bd65ff4710171006249ad4e0a12d2ab19be4210dae";
const DEMO_READY_IN = 6847; // seconds remaining for the not-ready scenario

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

    const appID = args["app-id"] || "0xA1B2C3D4E5F6000000000000000000000000abcd";
    const imageRef = flags["image-ref"] || flags.dockerfile || "myrepo/myapp:latest";
    const scenario = process.env.ECLOUD_DEMO_SCENARIO || "ready";

    // Error scenarios
    if (scenario === "no-schedule") {
      this.error(
        "No upgrade is scheduled for this app. Run 'ecloud compute app upgrade schedule' first.",
      );
    }

    if (scenario === "not-ready") {
      const readyDate = new Date(Date.now() + DEMO_READY_IN * 1000).toLocaleString();
      this.error(
        `Upgrade is not ready yet. Executable after ${chalk.bold(readyDate)} (${DEMO_READY_IN}s remaining).`,
      );
    }

    if (scenario === "mismatch") {
      this.error(
        "contract error: ReleaseMismatch\n" +
          "The provided build inputs do not match what was committed during 'upgrade schedule'.\n" +
          "Re-run with the exact same --image-ref, --env-file, and --instance-type.",
      );
    }

    // Happy path
    this.log(chalk.cyan("\nScheduled upgrade is ready. Proceeding with execution..."));
    this.log(chalk.yellow("Note: build inputs must exactly match what was used in 'upgrade schedule'."));

    this.log(chalk.gray("\nRebuilding image for verification..."));
    await demoDelay(700);
    this.log(chalk.gray(`  ✓ Image verified: ${imageRef}@${DEMO_DIGEST.slice(0, 23)}...`));
    await demoDelay(300);
    this.log(chalk.gray("  ✓ Release hash matched"));

    await demoDelay(900);

    this.log(
      `\n✅ ${chalk.green(`App upgraded successfully ${chalk.bold(`(id: ${appID}, image: ${imageRef})`)}`)}`,
    );
    this.log(
      `\n${chalk.gray("View your app:")} ${chalk.blue.underline(`https://app.eigencloud.xyz/apps/${appID}`)}`,
    );
  }
}
