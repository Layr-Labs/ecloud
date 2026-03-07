// [DEMO STUB] Network and build calls replaced with simulated output for UX review.
// Real implementation: taras/gov branch.
import { Command, Args, Flags } from "@oclif/core";
import { commonFlags } from "../../../../flags";
import chalk from "chalk";
import { getDemoState, setDemoState, isTimelockOverSafe, getSafeAddress } from "../../../../utils/demoState";

const DEMO_TX = "0x1a2b3c4d5e6f7890abcdef01234567890abcdef01234567890abcdef01234567";
const DEMO_DIGEST = "sha256:6da6226e847082ed23ac90bd65ff4710171006249ad4e0a12d2ab19be4210dae";

function parseDurationToSeconds(input: string): bigint {
  const match = input.match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d)?$/i);
  if (!match) throw new Error(`Invalid duration "${input}". Use format: 30s, 5m, 2h, 1d`);
  const value = parseFloat(match[1]);
  const unit = (match[2] || "s").toLowerCase();
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return BigInt(Math.ceil(value * multipliers[unit]));
}

function demoDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default class AppUpgradeSchedule extends Command {
  static description =
    "Schedule an upgrade for a timelocked app. The upgrade becomes executable after the specified delay.";

  static args = {
    "app-id": Args.string({
      description: "App ID or name to upgrade",
      required: false,
    }),
  };

  static flags = {
    ...commonFlags,
    after: Flags.string({
      required: true,
      description: "Delay before upgrade can execute (e.g. 30s, 5m, 2h, 1d)",
      env: "ECLOUD_UPGRADE_DELAY",
    }),
    dockerfile: Flags.string({
      required: false,
      description: "Path to Dockerfile",
      env: "ECLOUD_DOCKERFILE_PATH",
    }),
    "image-ref": Flags.string({
      required: false,
      description: "Image reference pointing to registry",
      env: "ECLOUD_IMAGE_REF",
    }),
    "env-file": Flags.string({
      required: false,
      description: 'Environment file to use (default: ".env")',
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
    const { args, flags } = await this.parse(AppUpgradeSchedule);

    let delaySeconds: bigint;
    try {
      delaySeconds = parseDurationToSeconds(flags.after);
    } catch (e: any) {
      this.error(e.message);
    }

    const appID = args["app-id"] || "0xA1B2C3D4E5F6000000000000000000000000abcd";
    const imageRef = flags["image-ref"] || flags.dockerfile || "myrepo/myapp:latest";

    // Check identity from state
    const state = getDemoState();
    const { identity } = state;
    if (!identity || identity.type !== "timelock") {
      const hint = !identity
        ? "Run 'ecloud auth login' first and select a Timelock identity."
        : identity.type === "safe"
          ? "You are logged in as a Safe — use 'ecloud compute app upgrade' for direct upgrades."
          : "You are logged in as an EOA — use 'ecloud compute app upgrade' for direct upgrades.";
      this.error(`This app is not timelocked. ${hint}`);
    }

    // Simulate build pipeline
    this.log(chalk.gray("\nBuilding image..."));
    await demoDelay(800);
    this.log(chalk.gray(`  ✓ Image pushed: ${imageRef}@${DEMO_DIGEST.slice(0, 23)}...`));
    await demoDelay(400);
    this.log(chalk.gray("  ✓ Environment variables encrypted"));
    await demoDelay(300);
    this.log(chalk.gray("  ✓ Release artifact prepared"));

    const readyAt = Math.floor(Date.now() / 1000) + Number(delaySeconds);
    const readyDate = new Date(readyAt * 1000).toLocaleString();

    this.log(`\nApp:         ${chalk.bold(appID)}`);
    this.log(`Delay:       ${chalk.bold(flags.after)} (executable after ${chalk.bold(readyDate)})`);
    this.log(`Image:       ${chalk.bold(imageRef)}`);

    await demoDelay(800);

    // Timelock(Safe): the schedule tx must also be approved by the Safe
    if (isTimelockOverSafe(identity)) {
      const safeAddr = getSafeAddress(identity)!;
      this.log(chalk.cyan(`\nTransaction proposed to Safe for scheduling. (${safeAddr.slice(0, 6)}...${safeAddr.slice(-4)})`));
      this.log(
        `${chalk.gray("View and sign at:")} ${chalk.blue.underline(`https://app.safe.global/transactions/queue?safe=eth:${safeAddr}`)}`,
      );
      this.log(chalk.gray("\n(Simulating Safe approval...)"));
      await demoDelay(1200);
    }

    // Persist scheduled upgrade so execute can pick it up
    setDemoState({ ...state, pendingSchedule: { appId: appID, imageRef, readyAt, delayLabel: flags.after } });

    this.log(`\n✅ ${chalk.green(`Upgrade scheduled (tx: ${DEMO_TX})`)}`);
    this.log(chalk.cyan(`\nExecutable after: ${chalk.bold(readyDate)}`));
    this.log(chalk.cyan(`Run to execute:   ecloud compute app upgrade execute --app=${appID} --image-ref=${imageRef}`));
  }
}
