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

export interface StoredIdentity {
  type: "eoa" | "safe" | "timelock";
  address: string;
  /** Present for safe/timelock — the chain they were deployed on */
  environment?: string;
  /** Timelock minimum delay in human-readable form, e.g. "24h" */
  delay?: string;
  /** For Timelock(Safe): the underlying Safe address */
  safeAddress?: string;
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
  directory_links?: {
    [environment: string]: {
      [directoryPath: string]: string;
    };
  };
  /** All known identities (EOA, Safe, Timelock) */
  identities?: StoredIdentity[];
  /** Active identity address per environment. EOA address means EOA flow. */
  active_identity?: {
    [environment: string]: string;
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

function normalizeDirectoryPath(directoryPath: string): string {
  const resolved = path.resolve(directoryPath);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/**
 * Get linked app ID for a directory in an environment
 */
export function getLinkedAppForDirectory(
  environment: string,
  directoryPath: string,
): string | null {
  if (!directoryPath) {
    return null;
  }

  const config = loadGlobalConfig();
  const links = config.directory_links?.[environment];
  if (!links) {
    return null;
  }

  const normalizedPath = normalizeDirectoryPath(directoryPath);
  const appId = links[normalizedPath];
  return appId || null;
}

/**
 * Link a directory to an app ID in an environment
 */
export function setLinkedAppForDirectory(
  environment: string,
  directoryPath: string,
  appId: string,
): void {
  if (!directoryPath || !environment) {
    return;
  }

  const config = loadGlobalConfig();
  if (!config.directory_links) {
    config.directory_links = {};
  }
  if (!config.directory_links[environment]) {
    config.directory_links[environment] = {};
  }

  const normalizedPath = normalizeDirectoryPath(directoryPath);
  // Normalize appId to lowercase for consistent lookups
  config.directory_links[environment][normalizedPath] = appId.toLowerCase();
  saveGlobalConfig(config);
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
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return (
    hex.slice(0, 4).join("") +
    hex.slice(4, 6).join("") +
    "-" +
    hex.slice(6, 8).join("") +
    "-" +
    hex.slice(8, 10).join("") +
    "-" +
    hex.slice(10, 12).join("") +
    "-" +
    hex.slice(12, 16).join("")
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

// ==================== Identity Functions ====================

/**
 * Get all stored identities
 */
export function getIdentities(): StoredIdentity[] {
  const config = loadGlobalConfig();
  return config.identities || [];
}

/**
 * Add an identity to the list (no-op if address already exists)
 */
export function addIdentity(identity: StoredIdentity): void {
  const config = loadGlobalConfig();
  if (!config.identities) config.identities = [];
  const exists = config.identities.some(
    (id) => id.address.toLowerCase() === identity.address.toLowerCase(),
  );
  if (!exists) {
    config.identities.push(identity);
  }
  saveGlobalConfig(config);
}

/**
 * Get the active identity address for an environment, or null if none set
 */
export function getActiveIdentityAddress(environment: string): string | null {
  const config = loadGlobalConfig();
  return config.active_identity?.[environment] ?? null;
}

/**
 * Get the full active identity object for an environment, or null
 */
export function getActiveIdentity(environment: string): StoredIdentity | null {
  const address = getActiveIdentityAddress(environment);
  if (!address) return null;
  const config = loadGlobalConfig();
  return (
    config.identities?.find((id) => id.address.toLowerCase() === address.toLowerCase()) ?? null
  );
}

/**
 * Set the active identity for an environment
 */
export function setActiveIdentity(environment: string, address: string): void {
  const config = loadGlobalConfig();
  if (!config.active_identity) config.active_identity = {};
  config.active_identity[environment] = address;
  saveGlobalConfig(config);
}

/**
 * Replace all stored identities with a new list (used when switching signing key)
 */
export function replaceAllIdentities(identities: StoredIdentity[]): void {
  const config = loadGlobalConfig();
  config.identities = identities;
  saveGlobalConfig(config);
}

/**
 * Clear the active identity for an environment (logout)
 */
export function clearActiveIdentity(environment: string): void {
  const config = loadGlobalConfig();
  if (config.active_identity) {
    delete config.active_identity[environment];
    saveGlobalConfig(config);
  }
}

/**
 * Format a stored identity for display
 */
export function formatIdentity(id: StoredIdentity): string {
  const short = id.address.slice(0, 6) + "..." + id.address.slice(-4);
  if (id.type === "eoa") return `${short}  (EOA)`;
  if (id.type === "safe") return `${short}  (Safe${id.environment ? ` · ${id.environment}` : ""})`;
  if (id.type === "timelock") {
    const via = id.safeAddress
      ? `via Safe ${id.safeAddress.slice(0, 6)}...${id.safeAddress.slice(-4)}`
      : "via EOA";
    return `${short}  (Timelock ${id.delay ?? ""} · ${via}${id.environment ? ` · ${id.environment}` : ""})`;
  }
  return short;
}
