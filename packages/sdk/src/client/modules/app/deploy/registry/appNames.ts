/**
 * App name registry
 *
 * Stores and retrieves app names (friendly names for app IDs)
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONFIG_DIR = path.join(os.homedir(), ".eigenx");
const APP_NAMES_FILE = "app_names.json";

interface AppNames {
  [environment: string]: {
    [appID: string]: string; // appID -> name
  };
}

/**
 * Set app name for an environment
 */
export async function setAppName(
  environment: string,
  appID: string,
  name: string,
): Promise<void> {
  // Ensure config directory exists
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  const filePath = path.join(CONFIG_DIR, APP_NAMES_FILE);
  let appNames: AppNames = {};

  // Load existing names
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      appNames = JSON.parse(content);
    } catch {
      // If file is corrupted, start fresh
      appNames = {};
    }
  }

  // Set the name
  if (!appNames[environment]) {
    appNames[environment] = {};
  }
  appNames[environment][appID.toLowerCase()] = name;

  // Save back to file
  fs.writeFileSync(filePath, JSON.stringify(appNames, null, 2));
}

/**
 * Get app name for an environment
 */
export function getAppName(environment: string, appID: string): string {
  const filePath = path.join(CONFIG_DIR, APP_NAMES_FILE);
  if (!fs.existsSync(filePath)) {
    return "";
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const appNames: AppNames = JSON.parse(content);
    return appNames[environment]?.[appID.toLowerCase()] || "";
  } catch {
    return "";
  }
}

/**
 * List all apps for an environment
 */
export function listApps(environment: string): Record<string, string> {
  const filePath = path.join(CONFIG_DIR, APP_NAMES_FILE);
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const appNames: AppNames = JSON.parse(content);
    // Invert the mapping: name -> appID
    const result: Record<string, string> = {};
    const envApps = appNames[environment] || {};
    for (const [appID, name] of Object.entries(envApps)) {
      result[name] = appID;
    }
    return result;
  } catch {
    return {};
  }
}
