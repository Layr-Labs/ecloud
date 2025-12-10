import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

import { Command, Flags } from "@oclif/core";
import { getBuildType } from "@layr-labs/ecloud-sdk";

import chalk from "chalk";
import { withTelemetry } from "../telemetry";

// Package being upgraded
const ecloudCLIPackage = "@layr-labs/ecloud-cli";

// Possible PackManagers being covered
export type PackageManager = "npm" | "pnpm" | "yarn" | "yarnBerry" | "bun" | "unknown";

// Detect package-manager from UA, check for bun as special case
export function detectPM(): PackageManager {
  const ua = process.env.npm_config_user_agent ?? "";

  if (ua.includes("pnpm/")) return "pnpm";
  if (ua.includes("yarn/1")) return "yarn";
  if (ua.match(/yarn\/[23]/)) return "yarnBerry";
  if (ua.includes("npm/")) return "npm";

  if (isBun()) return "bun";

  return "unknown";
}

// Detect bun using env falling back to checking for bun binary
function isBun(): boolean {
  const execPath = process.execPath?.toLowerCase() ?? "";
  if (execPath.includes("bun")) return true;

  if (process.env.BUN_INSTALL || process.env.BUN_RUNTIME) return true;

  try {
    const cmd = process.platform === "win32" ? "where bun" : "which bun";
    const p = execSync(cmd).toString().split(/\r?\n/)[0]?.trim();
    if (p && existsSync(p)) return true;
  } catch {
    // ignore
  }

  return false;
}

// Unified "upgrade global to latest" by manager
export function upgradePackage(packageManager?: string, buildTag = "latest"): void {
  const pm = packageManager ?? detectPM();

  const cmd = (() => {
    switch (pm) {
      case "npm":
        return `npm install -g ${ecloudCLIPackage}@${buildTag}`;
      case "pnpm":
        return `pnpm install -g ${ecloudCLIPackage}@${buildTag}`;
      case "yarn":
        return `yarn global add ${ecloudCLIPackage}@${buildTag}`;
      case "yarnBerry":
        // best effort, behaves more like a disposable global
        return `yarn dlx ${ecloudCLIPackage}@${buildTag}`;
      case "bun":
        return `bun add -g ${ecloudCLIPackage}@${buildTag}`;
      case "unknown":
      default:
        throw new Error();
    }
  })();

  execSync(cmd, { stdio: "inherit" });
}

// export Upgrade command to perform upgradePackage() call
export default class Upgrade extends Command {
  static description = "Upgrade ecloud-cli package";

  static flags = {
    "package-manager": Flags.string({
      required: false,
      description: "Explicitly set package-manager to use for upgrade",
      options: ["npm", "pnpm", "yarn", "yarnBerry", "bun"],
      env: "PACKAGE_MANAGER",
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(Upgrade);

    const buildType = getBuildType();
    const buildTag = buildType === "dev" ? "dev" : "latest";

    try {
      upgradePackage(flags["package-manager"], buildTag);
      this.log(`\n${chalk.green(`Upgrade successful!`)}`);
    } catch (e) {
      this.log(`\n${chalk.red(`Upgrade failed!`)}`);
      this.log(
        `\n${chalk.red(`Cannot determine package manager to upgrade ${ecloudCLIPackage}.`)}`,
      );
      this.log(
        `\n${chalk.red(`Use ${chalk.yellow("`package-manager`")} flag to instruct upgrade (<supported managers: npm|pnpm|yarn|yarnBerry|bun>).`)}\n`,
      );
      throw e;
    }
    });
  }
}
