import { Args, Command, Flags } from "@oclif/core";
import {
  getEnvironmentConfig,
  getAvailableEnvironments,
  isEnvironmentAvailable,
  setDefaultEnvironment,
} from "@layr-labs/ecloud-sdk";
import { getEnvironmentInteractive } from "../../../utils/prompts";
import { confirm } from "@inquirer/prompts";

/**
 * Check if an environment is a mainnet environment
 */
function isMainnetEnvironment(env: string): boolean {
  return env.includes("mainnet");
}

/**
 * Confirm mainnet environment selection
 */
async function confirmMainnetEnvironment(env: string): Promise<void> {
  if (!isMainnetEnvironment(env)) {
    return; // Not mainnet, no confirmation needed
  }

  console.log();
  console.log(`⚠️  WARNING: You selected ${env.toUpperCase()}`);
  console.log("⚠️  This environment uses real funds");
  console.log();

  const confirmed = await confirm({
    message: "Are you sure you want to use mainnet?",
    default: false,
  });

  if (!confirmed) {
    throw new Error("mainnet selection cancelled");
  }
}

export default class EnvironmentSet extends Command {
  static description = "Set deployment environment";

  static aliases = ['compute:environment:set', 'compute:env:set'];

  static args = {
    environment: Args.string(),
  };

  static flags = {
    yes: Flags.boolean({
      description: "Skip confirmation prompts (for automation)",
      default: false,
    }),
  };

  async run() {
    const { args, flags } = await this.parse(EnvironmentSet);

    // Get environment interactively if not provided
    const newEnv = args.environment || (await getEnvironmentInteractive());

    // Validate that the environment exists and is available
    if (!isEnvironmentAvailable(newEnv)) {
      const available = getAvailableEnvironments().join(", ");
      throw new Error(
        `Unknown environment: ${newEnv}\nRun 'ecloud environment list' to see available environments (${available})`
      );
    }

    // Validate environment config exists
    try {
      getEnvironmentConfig(newEnv);
    } catch (err: any) {
      throw new Error(`Invalid environment: ${newEnv} - ${err.message}`);
    }

    // Check if this is mainnet and requires confirmation
    if (isMainnetEnvironment(newEnv) && !flags.yes) {
      await confirmMainnetEnvironment(newEnv);
    }

    // Set the deployment environment
    setDefaultEnvironment(newEnv);

    console.log(`\n✅ Deployment environment set to ${newEnv}`);
  }
}

