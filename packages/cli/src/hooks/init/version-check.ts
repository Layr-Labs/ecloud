import { Hook } from "@oclif/core";
import chalk from "chalk";
import { confirm } from "@inquirer/prompts";
import { getBuildType } from "@layr-labs/ecloud-sdk";

import { getCliVersion } from "../../utils/version";
import { upgradePackage } from "../../commands/upgrade";

const SKIP_COMMANDS = new Set(["upgrade", "version"]);
const NPM_REGISTRY_URL = "https://registry.npmjs.org/@layr-labs/ecloud-cli";
const VERSION_CHECK_TIMEOUT_MS = 3000;

function isNewerVersion(current: string, latest: string): boolean {
  const parseParts = (v: string) => v.replace(/^v/, "").split(".").map(Number);
  const [cMajor = 0, cMinor = 0, cPatch = 0] = parseParts(current);
  const [lMajor = 0, lMinor = 0, lPatch = 0] = parseParts(latest);

  if (lMajor !== cMajor) return lMajor > cMajor;
  if (lMinor !== cMinor) return lMinor > cMinor;
  return lPatch > cPatch;
}

async function fetchLatestVersion(distTag: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VERSION_CHECK_TIMEOUT_MS);

    const response = await fetch(NPM_REGISTRY_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = (await response.json()) as { "dist-tags"?: Record<string, string> };
    return data["dist-tags"]?.[distTag] ?? null;
  } catch {
    return null;
  }
}

const hook: Hook<"init"> = async function (options) {
  const commandId = options.id;
  if (!commandId || SKIP_COMMANDS.has(commandId)) return;

  const currentVersion = getCliVersion();
  // Don't check for unpublished/development builds
  if (currentVersion === "0.0.0" || currentVersion === "0.0.0-development") return;

  const buildType = getBuildType();
  const distTag = buildType === "dev" ? "dev" : "latest";
  const latestVersion = await fetchLatestVersion(distTag);

  if (!latestVersion || !isNewerVersion(currentVersion, latestVersion)) return;

  this.log(
    chalk.yellow(
      `\nA new version of ecloud-cli is available: ${chalk.red(currentVersion)} -> ${chalk.green(latestVersion)}`,
    ),
  );

  const shouldUpdate = await confirm({
    message: "Would you like to update now?",
    default: true,
  });

  if (shouldUpdate) {
    try {
      upgradePackage(undefined, distTag);
      this.log(`\n${chalk.green("Upgrade successful!")}`);
      this.exit(0);
    } catch {
      this.log(`\n${chalk.yellow("Upgrade failed. Continuing with current version...")}\n`);
    }
  }
};

export default hook;
