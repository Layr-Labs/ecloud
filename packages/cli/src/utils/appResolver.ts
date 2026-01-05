/**
 * App Resolver - Centralized app name resolution with caching
 *
 * Resolution priority:
 * 1. Check if input is already a valid hex address
 * 2. Check profile cache (24h TTL)
 * 3. Fetch from remote API if cache miss/stale
 * 4. Fall back to local registry for legacy apps
 */

import { Address, Hex, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  UserApiClient,
  getAllAppsByDeveloper,
  EnvironmentConfig,
  AppInfo,
} from "@layr-labs/ecloud-sdk";
import { getProfileCache, setProfileCache, updateProfileCacheEntry } from "./globalConfig";
import {
  listApps as listLocalApps,
  getAppName as getLocalAppName,
  resolveAppIDFromRegistry,
} from "./appNames";
import { getClientId } from "./version";

const CHUNK_SIZE = 10;

/**
 * Fetch app infos in chunks (getInfos has a limit of 10 apps per request)
 * Fetches all chunks concurrently for better performance
 */
export async function getAppInfosChunked(
  userApiClient: UserApiClient,
  appIds: Address[],
  addressCount?: number,
): Promise<AppInfo[]> {
  if (appIds.length === 0) {
    return [];
  }

  const chunks: Address[][] = [];
  for (let i = 0; i < appIds.length; i += CHUNK_SIZE) {
    chunks.push(appIds.slice(i, i + CHUNK_SIZE));
  }

  const chunkResults = await Promise.all(
    chunks.map((chunk) => userApiClient.getInfos(chunk, addressCount)),
  );

  return chunkResults.flat();
}

/**
 * AppResolver handles app name resolution with remote profile support and caching
 */
export class AppResolver {
  private profileNames: Record<string, string> = {}; // appId (lowercase) -> name
  private cacheInitialized = false;

  constructor(
    private readonly environment: string,
    private readonly environmentConfig: EnvironmentConfig,
    private readonly privateKey?: string,
    private readonly rpcUrl?: string,
  ) {}

  /**
   * Resolve app name or ID to a valid Address
   * @param appIDOrName - App ID (hex address) or app name
   * @returns Resolved app address
   * @throws Error if app cannot be resolved
   */
  async resolveAppID(appIDOrName: string): Promise<Address> {
    if (!appIDOrName) {
      throw new Error("App ID or name is required");
    }

    // Normalize and check if it's already a valid address
    const normalized = appIDOrName.startsWith("0x") ? appIDOrName : `0x${appIDOrName}`;
    if (isAddress(normalized)) {
      return normalized as Address;
    }

    // Ensure cache is initialized
    await this.ensureCacheInitialized();

    // Search profile names for a match (case-insensitive)
    const searchName = appIDOrName.toLowerCase();
    for (const [appId, name] of Object.entries(this.profileNames)) {
      if (name.toLowerCase() === searchName) {
        return appId as Address;
      }
    }

    // Fall back to local registry
    const localAppId = resolveAppIDFromRegistry(this.environment, appIDOrName);
    if (localAppId) {
      return localAppId as Address;
    }

    throw new Error(`App '${appIDOrName}' not found in environment '${this.environment}'`);
  }

  /**
   * Get app name from app ID
   * @param appID - App address
   * @returns Profile name if found, empty string otherwise
   */
  async getAppName(appID: string | Address): Promise<string> {
    const normalizedId = String(appID).toLowerCase();

    // Ensure cache is initialized
    await this.ensureCacheInitialized();

    // Check profile names first
    const profileName = this.profileNames[normalizedId];
    if (profileName) {
      return profileName;
    }

    // Fall back to local registry
    return getLocalAppName(this.environment, appID as string);
  }

  /**
   * Check if an app name is available (not used by any existing app)
   * @param name - Name to check
   * @returns true if available, false if taken
   */
  async isAppNameAvailable(name: string): Promise<boolean> {
    await this.ensureCacheInitialized();

    const searchName = name.toLowerCase();

    // Check profile names
    for (const profileName of Object.values(this.profileNames)) {
      if (profileName.toLowerCase() === searchName) {
        return false;
      }
    }

    // Check local registry
    const localApps = listLocalApps(this.environment);
    return !localApps[name];
  }

  /**
   * Find an available app name by appending numbers if needed
   * @param baseName - Base name to start with
   * @returns Available name (may have number suffix)
   */
  async findAvailableName(baseName: string): Promise<string> {
    // Check if base name is available
    if (await this.isAppNameAvailable(baseName)) {
      return baseName;
    }

    // Try with incrementing numbers
    for (let i = 2; i <= 100; i++) {
      const candidate = `${baseName}-${i}`;
      if (await this.isAppNameAvailable(candidate)) {
        return candidate;
      }
    }

    // Fallback to timestamp if somehow we have 100+ duplicates
    return `${baseName}-${Date.now()}`;
  }

  /**
   * Get all profile names (for display/listing purposes)
   * @returns Map of appId -> name
   */
  async getAllProfileNames(): Promise<Record<string, string>> {
    await this.ensureCacheInitialized();
    return { ...this.profileNames };
  }

  /**
   * Update cache with a new profile name (call after deploy or profile set)
   */
  updateCacheEntry(appId: string, profileName: string): void {
    const normalizedId = appId.toLowerCase();
    this.profileNames[normalizedId] = profileName;
    updateProfileCacheEntry(this.environment, appId, profileName);
  }

  /**
   * Ensure the profile cache is initialized
   * Loads from disk cache if valid, otherwise fetches from API
   */
  private async ensureCacheInitialized(): Promise<void> {
    if (this.cacheInitialized) {
      return;
    }

    // Try to load from disk cache first
    const cachedProfiles = getProfileCache(this.environment);
    if (cachedProfiles) {
      this.profileNames = cachedProfiles;
      this.cacheInitialized = true;
      return;
    }

    // Cache miss or expired - fetch from API
    await this.fetchProfilesFromAPI();
    this.cacheInitialized = true;
  }

  /**
   * Fetch profile names from the remote API and update cache
   */
  private async fetchProfilesFromAPI(): Promise<void> {
    // Need private key and rpcUrl for authenticated API calls
    if (!this.privateKey || !this.rpcUrl) {
      // Can't fetch from API without credentials - use empty cache
      this.profileNames = {};
      return;
    }

    try {
      // Get all apps for the current developer
      const account = privateKeyToAccount(this.privateKey as Hex);
      const { apps } = await getAllAppsByDeveloper(
        this.rpcUrl,
        this.environmentConfig,
        account.address,
      );

      if (apps.length === 0) {
        this.profileNames = {};
        setProfileCache(this.environment, {});
        return;
      }

      // Fetch info for all apps to get profile names
      const userApiClient = new UserApiClient(
        this.environmentConfig,
        this.privateKey,
        this.rpcUrl,
        getClientId(),
      );
      const appInfos = await getAppInfosChunked(userApiClient, apps);

      // Build profile names map
      const profiles: Record<string, string> = {};
      for (const info of appInfos) {
        if (info.profile?.name) {
          const normalizedId = String(info.address).toLowerCase();
          profiles[normalizedId] = info.profile.name;
        }
      }

      this.profileNames = profiles;
      setProfileCache(this.environment, profiles);
    } catch (error) {
      // On error, use empty cache - don't fail the command
      console.debug?.("Failed to fetch profiles from API:", error);
      this.profileNames = {};
    }
  }
}

/**
 * Create an AppResolver instance
 * Convenience function for creating resolver with common parameters
 */
export function createAppResolver(
  environment: string,
  environmentConfig: EnvironmentConfig,
  privateKey?: string,
  rpcUrl?: string,
): AppResolver {
  return new AppResolver(environment, environmentConfig, privateKey, rpcUrl);
}
