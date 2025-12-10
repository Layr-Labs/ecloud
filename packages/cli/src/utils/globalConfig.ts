/**
 * Global configuration management
 *
 * Stores user-level configuration that persists across all CLI usage.
 * - $XDG_CONFIG_HOME/ecloud[BuildSuffix]/config.yaml (if XDG_CONFIG_HOME is set)
 * - Or ~/.config/ecloud[BuildSuffix]/config.yaml (fallback)
 *
 * Where BuildSuffix is:
 * - "" (empty) for production builds
 * - "-dev" for development builds
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { load as loadYaml, dump as dumpYaml } from "js-yaml";
import { getBuildType } from "@layr-labs/ecloud-sdk";
import * as crypto from "crypto";
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

// Profile cache TTL: 24 hours in milliseconds
const PROFILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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
 * Get the user's preferred deployment environment
 */
export function getDefaultEnvironment(): string | undefined {
  const config = loadGlobalConfig();
  return config.default_environment;
}

/**
 * Set the user's preferred deployment environment
 */
export function setDefaultEnvironment(environment: string): void {
  const config = loadGlobalConfig();
  config.default_environment = environment;
  config.first_run = false; // No longer first run after setting environment
  saveGlobalConfig(config);
}

/**
 * Check if this is the user's first time running the CLI
 */
export function isFirstRun(): boolean {
  const config = loadGlobalConfig();
  return config.first_run === true;
}

/**
 * Mark that the first run has been completed
 */
export function markFirstRunComplete(): void {
  const config = loadGlobalConfig();
  config.first_run = false;
  saveGlobalConfig(config);
}

/**
 * Get the global telemetry preference
 */
export function getGlobalTelemetryPreference(): boolean | undefined {
  const config = loadGlobalConfig();
  return config.telemetry_enabled;
}

/**
 * Set the global telemetry preference
 */
export function setGlobalTelemetryPreference(enabled: boolean): void {
  const config = loadGlobalConfig();
  config.telemetry_enabled = enabled;
  config.first_run = false; // No longer first run after setting preference
  saveGlobalConfig(config);
}

// ==================== Profile Cache Functions ====================

/**
 * Get cached profile names for an environment
 * Returns null if cache is missing or expired (older than 24 hours)
 */
export function getProfileCache(environment: string): Record<string, string> | null {
  const config = loadGlobalConfig();
  const cacheEntry = config.profile_cache?.[environment];

  if (!cacheEntry) {
    return null;
  }

  // Check if cache is expired
  const now = Date.now();
  if (now - cacheEntry.updated_at > PROFILE_CACHE_TTL_MS) {
    return null;
  }

  return cacheEntry.profiles;
}

/**
 * Set cached profile names for an environment
 */
export function setProfileCache(environment: string, profiles: Record<string, string>): void {
  const config = loadGlobalConfig();

  if (!config.profile_cache) {
    config.profile_cache = {};
  }

  config.profile_cache[environment] = {
    updated_at: Date.now(),
    profiles,
  };

  saveGlobalConfig(config);
}

/**
 * Invalidate profile cache for a specific environment or all environments
 */
export function invalidateProfileCache(environment?: string): void {
  const config = loadGlobalConfig();

  if (!config.profile_cache) {
    return;
  }

  if (environment) {
    // Invalidate specific environment
    delete config.profile_cache[environment];
  } else {
    // Invalidate all environments
    config.profile_cache = {};
  }

  saveGlobalConfig(config);
}

/**
 * Update a single profile name in the cache
 * This is useful after deploy or profile set to update just one entry
 */
export function updateProfileCacheEntry(
  environment: string,
  appId: string,
  profileName: string,
): void {
  const config = loadGlobalConfig();

  if (!config.profile_cache) {
    config.profile_cache = {};
  }

  if (!config.profile_cache[environment]) {
    config.profile_cache[environment] = {
      updated_at: Date.now(),
      profiles: {},
    };
  }

  // Normalize appId to lowercase for consistent lookups
  const normalizedAppId = appId.toLowerCase();
  config.profile_cache[environment].profiles[normalizedAppId] = profileName;
  config.profile_cache[environment].updated_at = Date.now();

  saveGlobalConfig(config);
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
  // Use cryptographically secure random values.
  const bytes = crypto.randomBytes(16);
  // Per RFC 4122 section 4.4, set bits for version and `clock_seq_hi_and_reserved`
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') + hex.slice(4, 6).join('') + '-' +
    hex.slice(6, 8).join('') + '-' +
    hex.slice(8, 10).join('') + '-' +
    hex.slice(10, 12).join('') + '-' +
    hex.slice(12, 16).join('')
  );
}

/**
 * Save user UUID to global config (preserves existing UUID if present)
 */
export function saveUserUUID(userUUID: string): void {
  const config = loadGlobalConfig();
  // Only update if not already set
  if (!config.user_uuid) {
    config.user_uuid = userUUID;
    saveGlobalConfig(config);
  }
}

