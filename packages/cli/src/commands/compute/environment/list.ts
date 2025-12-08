import { Command } from "@oclif/core";
import { getAvailableEnvironments, getEnvironmentConfig } from "@layr-labs/ecloud-sdk";
import { getDefaultEnvironment } from "../../../utils/globalConfig";
import chalk from "chalk";

/**
 * Get environment description
 */
function getEnvironmentDescription(name: string): string {
  switch (name) {
    case "sepolia":
      return "- Ethereum Sepolia testnet";
    case "sepolia-dev":
      return "- Ethereum Sepolia testnet (dev)";
    case "mainnet-alpha":
      return "- Ethereum mainnet (⚠️  uses real funds)";
    default:
      return "";
  }
}

export default class EnvironmentList extends Command {
  static description = "List available deployment environments";

  static aliases = ["compute:environment:list", "compute:env:list"];

  async run() {
    const availableEnvs = getAvailableEnvironments();
    const currentEnv = getDefaultEnvironment();

    console.log("Available deployment environments:");

    for (const name of availableEnvs) {
      try {
        const config = getEnvironmentConfig(name);
        const description = getEnvironmentDescription(name) || `- ${config.name}`;
        const marker = currentEnv === name ? ` ${chalk.green("(active)")}` : "";
        console.log(`  • ${name} ${description}${marker}`);
      } catch {
        // Skip environments that can't be loaded
        console.log(`  • ${name} (unavailable)`);
      }
    }
  }
}
