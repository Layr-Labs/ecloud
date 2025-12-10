/**
 * Global configuration management
 *
 * Stores user-level configuration that persists across all SDK usage.
 * - $XDG_CONFIG_HOME/ecloud[BuildSuffix]/config.yaml (if XDG_CONFIG_HOME is set)
 * - Or ~/.config/ecloud[BuildSuffix]/config.yaml (fallback)
 *
 * Where BuildSuffix is:
 * - "" (empty) for production builds
 * - "-dev" for development builds
 *
 * This is a replica of the globalConfig from the CLI package, allowing the SDK
 * to access the same shared configuration file.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { load as loadYaml, dump as dumpYaml } from "js-yaml";
import { getBuildType } from "./environment";

const GLOBAL_CONFIG_FILE = "config.yaml";

export interface ProfileCacheEntry {
  updated_at: number; // Unix timestamp in milliseconds
  profiles: { [appId: string]: string }; // appId -> profile name
}

export interface GlobalConfig {
  first_run?: boolean;
  telemetry_enabled?: boolean;
  user_uuid?: string;
  default_environment?: string;
  last_version_check?: number;
  last_known_version?: string;
  profile_cache?: {
    [environment: string]: ProfileCacheEntry;
  };
}

/**
 * Get the XDG-compliant directory where global ecloud config should be stored
 */
function getGlobalConfigDir(): string {
  // First check XDG_CONFIG_HOME
  const configHome = process.env.XDG_CONFIG_HOME;

  let baseDir: string;
  if (configHome && path.isAbsolute(configHome)) {
    baseDir = configHome;
  } else {
    // Fall back to ~/.config
    baseDir = path.join(os.homedir(), ".config");
  }

  // Use environment-specific config directory
  const buildType = getBuildType();
  const buildSuffix = buildType === "dev" ? "-dev" : "";
  const configDirName = `ecloud${buildSuffix}`;

  return path.join(baseDir, configDirName);
}

/**
 * Get the full path to the global config file
 */
function getGlobalConfigPath(): string {
  return path.join(getGlobalConfigDir(), GLOBAL_CONFIG_FILE);
}

/**
 * Load global configuration, creating defaults if needed
 */
export function loadGlobalConfig(): GlobalConfig {
  const configPath = getGlobalConfigPath();

  // If file doesn't exist, return defaults for first run
  if (!fs.existsSync(configPath)) {
    return {
      first_run: true,
    };
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const config = loadYaml(content) as GlobalConfig;
    return config || { first_run: true };
  } catch {
    // If parsing fails, return defaults
    return {
      first_run: true,
    };
  }
}

/**
 * Save global configuration to disk
 */
export function saveGlobalConfig(config: GlobalConfig): void {
  const configPath = getGlobalConfigPath();

  // Ensure directory exists
  const configDir = path.dirname(configPath);
  fs.mkdirSync(configDir, { recursive: true, mode: 0o755 });

  // Write config file
  const content = dumpYaml(config, { lineWidth: -1 });
  fs.writeFileSync(configPath, content, { mode: 0o644 });
}

/**
 * Get the global telemetry preference
 */
export function getGlobalTelemetryPreference(): boolean | undefined {
  const config = loadGlobalConfig();
  return config.telemetry_enabled;
}

/**
 * Get the user UUID from global config, or generate a new one if it doesn't exist
 */
export function getOrCreateUserUUID(): string {
  const config = loadGlobalConfig();
  if (config.user_uuid) {
    return config.user_uuid;
  }

  // Generate a new UUID (v4)
  const uuid = generateUUID();
  
  // Save it to config
  config.user_uuid = uuid;
  config.first_run = false;
  saveGlobalConfig(config);
  
  return uuid;
}

/**
 * Generate a UUID v4
 */
function generateUUID(): string {
  // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
