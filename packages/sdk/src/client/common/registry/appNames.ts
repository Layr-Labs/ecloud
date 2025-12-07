/**
 * App name registry
 *
 * - Stores in ~/.eigenx/apps/{environment}.yaml
 * - Uses YAML format with version and apps structure
 * - Format: {version: "1.0.0", apps: {name: {app_id: "...", created_at: ..., updated_at: ...}}}
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { load as loadYaml, dump as dumpYaml } from "js-yaml";

const CONFIG_DIR = path.join(os.homedir(), ".eigenx");
const APPS_DIR = path.join(CONFIG_DIR, "apps");
const APP_REGISTRY_VERSION = "1.0.0";

interface AppRegistry {
  version: string;
  apps: {
    [name: string]: {
      app_id: string;
      created_at?: string;
      updated_at?: string;
    };
  };
}

/**
 * Get the path to the app registry file for an environment
 */
function getAppRegistryPath(environment: string): string {
  return path.join(APPS_DIR, `${environment}.yaml`);
}

/**
 * Load app registry from disk
 */
function loadAppRegistry(environment: string): AppRegistry {
  const filePath = getAppRegistryPath(environment);

  // If file doesn't exist, return empty registry
  if (!fs.existsSync(filePath)) {
    return {
      version: APP_REGISTRY_VERSION,
      apps: {},
    };
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const registry = loadYaml(content) as AppRegistry;

    // Initialize apps map if nil
    if (!registry.apps) {
      registry.apps = {};
    }

    return registry;
  } catch {
    // If parsing fails, return empty registry
    return {
      version: APP_REGISTRY_VERSION,
      apps: {},
    };
  }
}

/**
 * Save app registry to disk
 */
function saveAppRegistry(environment: string, registry: AppRegistry): void {
  const filePath = getAppRegistryPath(environment);

  // Ensure directory exists
  if (!fs.existsSync(APPS_DIR)) {
    fs.mkdirSync(APPS_DIR, { recursive: true });
  }

  // Write YAML file
  const yamlContent = dumpYaml(registry, {
    lineWidth: -1, // No line wrapping
    quotingType: '"',
  });
  fs.writeFileSync(filePath, yamlContent, { mode: 0o644 });
}

/**
 * Resolve app ID or name to app ID
 */
function resolveAppID(environment: string, appIDOrName: string): string | null {
  // First check if it's already a valid hex address
  if (/^0x[a-fA-F0-9]{40}$/.test(appIDOrName)) {
    return appIDOrName;
  }

  // Try to load from registry
  const registry = loadAppRegistry(environment);

  // Look up by name
  const app = registry.apps[appIDOrName];
  if (app) {
    return app.app_id;
  }

  return null;
}

/**
 * Set app name for an environment
 */
export async function setAppName(
  environment: string,
  appIDOrName: string,
  newName: string,
): Promise<void> {
  const registry = loadAppRegistry(environment);

  // Resolve the target app ID
  let targetAppID: string | null = resolveAppID(environment, appIDOrName);
  if (!targetAppID) {
    // If can't resolve, check if it's a valid app ID
    if (/^0x[a-fA-F0-9]{40}$/.test(appIDOrName)) {
      targetAppID = appIDOrName;
    } else {
      throw new Error(`invalid app ID or name: ${appIDOrName}`);
    }
  }

  // Normalize app ID for comparison
  const targetAppIDLower = targetAppID.toLowerCase();

  // Find and remove any existing names for this app ID
  for (const [name, app] of Object.entries(registry.apps)) {
    if (app?.app_id && String(app.app_id).toLowerCase() === targetAppIDLower) {
      delete registry.apps[name];
    }
  }

  // If newName is empty, we're just removing the name
  if (newName === "") {
    saveAppRegistry(environment, registry);
    return;
  }

  // Add the new name entry
  const now = new Date().toISOString();
  registry.apps[newName] = {
    app_id: targetAppID,
    created_at: now,
    updated_at: now,
  };

  saveAppRegistry(environment, registry);
}

/**
 * Get app name for an environment
 */
export function getAppName(environment: string, appID: string): string {
  const registry = loadAppRegistry(environment);
  const normalizedAppID = appID.toLowerCase();

  // Search for the app ID in the registry
  for (const [name, app] of Object.entries(registry.apps)) {
    if (app?.app_id && String(app.app_id).toLowerCase() === normalizedAppID) {
      return name;
    }
  }

  return "";
}

/**
 * List all apps for an environment
 */
export function listApps(environment: string): Record<string, string> {
  const registry = loadAppRegistry(environment);
  const result: Record<string, string> = {};

  // Convert registry format (name -> app_id) to result format (name -> appID)
  for (const [name, app] of Object.entries(registry.apps)) {
    if (app?.app_id) {
      result[name] = String(app.app_id);
    }
  }

  return result;
}
