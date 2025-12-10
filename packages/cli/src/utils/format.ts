/**
 * Shared formatting utilities for CLI display
 */

import chalk from "chalk";
import type { AppInfo } from "@layr-labs/ecloud-sdk";

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/**
 * Format app status with color
 */
export function formatStatus(status: string): string {
  switch (status.toLowerCase()) {
    case "running":
    case "started":
      return chalk.green(status);
    case "stopped":
      return chalk.yellow(status);
    case "terminated":
      return chalk.red(status);
    case "suspended":
      return chalk.red(status);
    case "deploying":
    case "upgrading":
    case "resuming":
    case "stopping":
      return chalk.cyan(status);
    case "failed":
      return chalk.red(status);
    default:
      return chalk.gray(status);
  }
}

/**
 * Options for formatting app display
 */
export interface FormatAppDisplayOptions {
  /** App info from UserAPI */
  appInfo: AppInfo;
  /** Override app name (e.g., from local registry) */
  appName?: string;
  /** Override status string */
  status?: string;
  /** Release timestamp (unix seconds) */
  releaseTimestamp?: number;
  /** Whether to show profile details (website, description, xURL) */
  showProfileDetails?: boolean;
}

/**
 * Formatted app display data - pre-formatted strings ready for display
 */
export interface FormattedAppDisplay {
  name: string;
  id: string;
  releaseTime: string;
  status: string;
  instance: string;
  ip: string;
  cpu: string;
  memory: string;
  memoryUsage: string;
  evmAddresses: Array<{ address: string; path: string }>;
  solanaAddresses: Array<{ address: string; path: string }>;
  profile?: {
    website?: string;
    description?: string;
    xURL?: string;
  };
}

/**
 * Format app info into display-ready strings
 * This can be used by both info and list commands
 */
export function formatAppDisplay(options: FormatAppDisplayOptions): FormattedAppDisplay {
  const { appInfo, appName, status, releaseTimestamp, showProfileDetails = false } = options;

  // Name
  const displayName = appName || appInfo.profile?.name;
  const name = displayName ? chalk.cyan(displayName) : chalk.gray("(unnamed)");

  // ID
  const id = chalk.gray(appInfo.address);

  // Release time
  const releaseTime = releaseTimestamp
    ? chalk.gray(new Date(releaseTimestamp * 1000).toISOString().replace("T", " ").slice(0, 19))
    : chalk.gray("-");

  // Status
  const statusStr = status || appInfo.status;
  const formattedStatus = formatStatus(statusStr);

  // Instance
  const instance =
    appInfo.machineType && appInfo.machineType !== "No instance assigned"
      ? chalk.gray(appInfo.machineType)
      : chalk.gray("-");

  // IP
  const ip =
    appInfo.ip && appInfo.ip !== "No IP assigned"
      ? chalk.white(appInfo.ip)
      : chalk.gray("No IP assigned");

  // Metrics
  const metrics = appInfo.metrics;
  const cpu =
    metrics?.cpu_utilization_percent !== undefined
      ? chalk.white(`${metrics.cpu_utilization_percent.toFixed(1)}%`)
      : chalk.gray("-");

  const memory =
    metrics?.memory_utilization_percent !== undefined
      ? chalk.white(`${metrics.memory_utilization_percent.toFixed(1)}%`)
      : chalk.gray("-");

  const memoryUsage =
    metrics?.memory_used_bytes !== undefined && metrics?.memory_total_bytes !== undefined
      ? chalk.gray(
          `(${formatBytes(metrics.memory_used_bytes)} / ${formatBytes(metrics.memory_total_bytes)})`,
        )
      : "";

  // EVM addresses
  const evmAddresses = (appInfo.evmAddresses || []).map((addr) => ({
    address: addr.address,
    path: addr.derivationPath,
  }));

  // Solana addresses
  const solanaAddresses = (appInfo.solanaAddresses || []).map((addr) => ({
    address: addr.address,
    path: addr.derivationPath,
  }));

  // Profile details
  let profile: FormattedAppDisplay["profile"];
  if (showProfileDetails && appInfo.profile) {
    const p = appInfo.profile;
    if (p.website || p.description || p.xURL) {
      profile = {
        website: p.website,
        description: p.description,
        xURL: p.xURL,
      };
    }
  }

  return {
    name,
    id,
    releaseTime,
    status: formattedStatus,
    instance,
    ip,
    cpu,
    memory,
    memoryUsage,
    evmAddresses,
    solanaAddresses,
    profile,
  };
}

/**
 * Print formatted app display with given indent
 * @param display - Formatted app display data
 * @param log - Log function (e.g., this.log from Command)
 * @param indent - Indentation string (default: "  ")
 * @param options - Additional display options
 */
export function printAppDisplay(
  display: FormattedAppDisplay,
  log: (msg: string) => void,
  indent = "  ",
  options: {
    /** Show only first address (for list view) */
    singleAddress?: boolean;
    /** Show profile details section */
    showProfile?: boolean;
  } = {},
): void {
  const { singleAddress = false, showProfile = false } = options;

  log(`${indent}ID:             ${display.id}`);
  log(`${indent}Release Time:   ${display.releaseTime}`);
  log(`${indent}Status:         ${display.status}`);
  log(`${indent}Instance:       ${display.instance}`);
  log(`${indent}IP:             ${display.ip}`);
  log(`${indent}CPU:            ${display.cpu}`);
  log(`${indent}Memory:         ${display.memory} ${display.memoryUsage}`);

  // EVM addresses
  if (display.evmAddresses.length > 0) {
    const addrs = singleAddress ? display.evmAddresses.slice(0, 1) : display.evmAddresses;
    for (let i = 0; i < addrs.length; i++) {
      const addr = addrs[i];
      const label = i === 0 ? "EVM Address:" : "            ";
      log(`${indent}${label}    ${chalk.gray(`${addr.address} (path: ${addr.path})`)}`);
    }
  } else {
    log(`${indent}EVM Address:    ${chalk.gray("-")}`);
  }

  // Solana addresses
  if (display.solanaAddresses.length > 0) {
    const addrs = singleAddress ? display.solanaAddresses.slice(0, 1) : display.solanaAddresses;
    for (let i = 0; i < addrs.length; i++) {
      const addr = addrs[i];
      const label = i === 0 ? "Solana Address:" : "               ";
      log(`${indent}${label} ${chalk.gray(`${addr.address} (path: ${addr.path})`)}`);
    }
  } else {
    log(`${indent}Solana Address: ${chalk.gray("-")}`);
  }

  // Profile details
  if (showProfile && display.profile) {
    log(
      chalk.gray(`${indent}────────────────────────────────────────────────────────────────────`),
    );
    if (display.profile.website) {
      log(`${indent}Website:        ${chalk.gray(display.profile.website)}`);
    }
    if (display.profile.description) {
      log(`${indent}Description:    ${chalk.gray(display.profile.description)}`);
    }
    if (display.profile.xURL) {
      log(`${indent}X (Twitter):    ${chalk.gray(display.profile.xURL)}`);
    }
  }
}
