import { Hook } from "@oclif/core";
import chalk from "chalk";
import { confirm } from "@inquirer/prompts";
import { getBuildType } from "@layr-labs/ecloud-sdk";

import { getCliVersion } from "../../utils/version";
import { upgradePackage } from "../../commands/upgrade";
import { loadGlobalConfig, saveGlobalConfig } from "../../utils/globalConfig";

const SKIP_COMMANDS = new Set(["upgrade", "version"]);
const NPM_REGISTRY_URL = "https://registry.npmjs.org/@layr-labs/ecloud-cli";
const VERSION_CHECK_TIMEOUT_MS = 3000;
const VERSION_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

function parseVersion(v: string): { major: number; minor: number; patch: number; prerelease: string | null } {
  const clean = v.replace(/^v/, "");
  const [core, ...rest] = clean.split("-");
  const [major = 0, minor = 0, patch = 0] = core.split(".").map(Number);
  const prerelease = rest.length > 0 ? rest.join("-") : null;
  return { major, minor, patch, prerelease };
}

function comparePrerelease(a: string | null, b: string | null): number {
  // No prerelease = release, which is higher than any prerelease
  if (a === null && b === null) return 0;
  if (a === null) return 1; // a is release, b is prerelease → a > b
  if (b === null) return -1; // a is prerelease, b is release → a < b

  // Compare prerelease segments (e.g. "dev.1" vs "dev.2")
  const aParts = a.split(".");
  const bParts = b.split(".");
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const ap = aParts[i];
    const bp = bParts[i];
    if (ap === undefined) return -1;
    if (bp === undefined) return 1;
    const aNum = Number(ap);
    const bNum = Number(bp);
    if (!isNaN(aNum) && !isNaN(bNum)) {
      if (aNum !== bNum) return aNum - bNum;
    } else {
      if (ap < bp) return -1;
      if (ap > bp) return 1;
    }
  }
  return 0;
}

function isNewerVersion(current: string, latest: string): boolean {
  const c = parseVersion(current);
  const l = parseVersion(latest);

  if (l.major !== c.major) return l.major > c.major;
  if (l.minor !== c.minor) return l.minor > c.minor;
  if (l.patch !== c.patch) return l.patch > c.patch;
  return comparePrerelease(l.prerelease, c.prerelease) > 0;
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

  const globalConfig = loadGlobalConfig();
  const now = Date.now();
  const cacheIsFresh =
    globalConfig.last_version_check != null &&
    now - globalConfig.last_version_check < VERSION_CHECK_INTERVAL_MS;

  let latestVersion: string | null;
  if (cacheIsFresh && globalConfig.last_known_version) {
    latestVersion = globalConfig.last_known_version;
  } else {
    latestVersion = await fetchLatestVersion(distTag);
    if (latestVersion) {
      globalConfig.last_version_check = now;
      globalConfig.last_known_version = latestVersion;
      saveGlobalConfig(globalConfig);
    }
  }

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
