import { Command } from "@oclif/core";
import { getEnvironmentConfig, getAvailableEnvironments } from "@layr-labs/ecloud-sdk";
import { getDefaultEnvironment } from "../../../utils/globalConfig";
import chalk from "chalk";

export default class EnvironmentShow extends Command {
  static description = "Show active deployment environment";

  static aliases = ["compute:environment:show", "compute:env:show"];

  async run() {
    const defaultEnv = getDefaultEnvironment();
    const availableEnvs = getAvailableEnvironments();

    if (!defaultEnv) {
      // No default set, use fallback
      const fallbackEnv = availableEnvs[0] || "sepolia";
      try {
        const envConfig = getEnvironmentConfig(fallbackEnv);
        console.log(
          `Active deployment environment: ${chalk.green(envConfig.name)} (fallback default)`,
        );
        console.log(
          "Run 'ecloud environment set <env>' to set your preferred deployment environment",
        );
      } catch {
        console.log(
          `Active deployment environment: ${chalk.green(fallbackEnv)} (fallback default)`,
        );
        console.log(
          "Run 'ecloud environment set <env>' to set your preferred deployment environment",
        );
      }
    } else {
      try {
        const envConfig = getEnvironmentConfig(defaultEnv);
        console.log(`Active deployment environment: ${chalk.green(envConfig.name)}`);
      } catch {
        console.log(`Active deployment environment: ${chalk.green(defaultEnv)}`);
      }
    }

    console.log(
      `\nRun '${chalk.yellow("ecloud compute environment list")}' to see available deployment environments`,
    );
  }
}
