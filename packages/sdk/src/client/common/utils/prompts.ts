/**
 * Interactive prompts using @inquirer/prompts
 */

import { input, select, password, confirm as inquirerConfirm } from "@inquirer/prompts";
import fs from "fs";
import path from "path";
import os from "os";
import { Address, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { listApps, getAppName } from "../registry/appNames";
import { getEnvironmentConfig, getAvailableEnvironments, isEnvironmentAvailable } from "../config/environment";
import { getAllAppsByDeveloper } from "../contract/caller";
import { UserApiClient } from "./userapi";
import { addHexPrefix, stripHexPrefix } from "./helpers";

/**
 * Prompt for Dockerfile selection
 */
export async function getDockerfileInteractive(
  dockerfilePath?: string,
): Promise<string> {
  // Check if provided via option
  if (dockerfilePath) {
    return dockerfilePath;
  }

  // Check if default Dockerfile exists
  if (!fs.existsSync("Dockerfile")) {
    // No Dockerfile found, return empty string (deploy existing image)
    return "";
  }

  // Interactive prompt when Dockerfile exists
  console.log("\nFound Dockerfile in current directory.");

  const choice = await select({
    message: "Choose deployment method:",
    choices: [
      { name: "Build and deploy from Dockerfile", value: "build" },
      { name: "Deploy existing image from registry", value: "existing" },
    ],
  });

  switch (choice) {
    case "build":
      return "Dockerfile";
    case "existing":
      return "";
    default:
      throw new Error(`Unexpected choice: ${choice}`);
  }
}

/**
 * Prompt for image reference
 */
export async function getImageReferenceInteractive(
  imageRef?: string,
  buildFromDockerfile: boolean = false,
): Promise<string> {
  // Check if provided
  if (imageRef) {
    return imageRef;
  }

  // Get available registries
  const registries = await getAvailableRegistries();
  const appName = getDefaultAppName();

  // Interactive prompt
  if (buildFromDockerfile) {
    console.log("\n📦 Build & Push Configuration");
    console.log("Your Docker image will be built and pushed to a registry");
    console.log("so that EigenX can pull and run it in the TEE.");
    console.log();

    if (registries.length > 0) {
      displayDetectedRegistries(registries, appName);
      return selectRegistryInteractive(registries, appName, "latest");
    }

    // No registries detected
    displayAuthenticationInstructions();
  } else {
    console.log("\n🐳 Docker Image Selection");
    console.log(
      "Specify an existing Docker image from a registry to run in the TEE.",
    );
    console.log();
  }

  // Fallback to manual input
  displayRegistryExamples(appName);

  const imageRefInput = await input({
    message: "Enter Docker image reference:",
    default: "",
    validate: validateImageReference,
  });

  return imageRefInput;
}

/**
 * Prompt for app name
 */
export async function getOrPromptAppName(
  appName: string | undefined,
  environment: string,
  imageRef: string,
): Promise<string> {
  // Check if provided
  if (appName) {
    // Validate the provided name
    validateAppName(appName);
    // Check if it's available
    if (isAppNameAvailable(environment, appName)) {
      return appName;
    }
    console.log(`Warning: App name '${appName}' is already taken.`);
    return getAvailableAppNameInteractive(environment, imageRef);
  }

  // No name provided, get interactively
  return getAvailableAppNameInteractive(environment, imageRef);
}

/**
 * Get available app name interactively
 */
async function getAvailableAppNameInteractive(
  environment: string,
  imageRef: string,
): Promise<string> {
  // Start with a suggestion from the image
  const baseName = extractAppNameFromImage(imageRef);
  const suggestedName = findAvailableName(environment, baseName);

  while (true) {
    console.log("\nApp name selection:");
    const name = await input({
      message: "Enter app name:",
      default: suggestedName,
      validate: (value: string) => {
        try {
          validateAppName(value);
          return true;
        } catch (err: any) {
          return err.message;
        }
      },
    });

    // Check if the name is available
    if (isAppNameAvailable(environment, name)) {
      return name;
    }

    // Name is taken, suggest alternatives and loop
    console.log(`App name '${name}' is already taken.`);
    const newSuggested = findAvailableName(environment, name);
    console.log(`Suggested alternative: ${newSuggested}`);
  }
}

/**
 * Prompt for environment file
 */
export async function getEnvFileInteractive(
  envFilePath?: string,
): Promise<string> {
  // Check if provided via option and exists
  if (envFilePath && fs.existsSync(envFilePath)) {
    return envFilePath;
  }

  // Check if default .env exists
  if (fs.existsSync(".env")) {
    return ".env";
  }

  // Interactive prompt when env file doesn't exist
  console.log("\nEnvironment file not found.");
  console.log("Environment files contain variables like RPC_URL, etc.");

  const choice = await select({
    message: "Choose an option:",
    choices: [
      { name: "Enter path to existing env file", value: "enter" },
      { name: "Continue without env file", value: "continue" },
    ],
  });

  switch (choice) {
    case "enter":
      const envFile = await input({
        message: "Enter environment file path:",
        default: "",
        validate: validateFilePath,
      });
      return envFile;
    case "continue":
      return "";
    default:
      throw new Error(`Unexpected choice: ${choice}`);
  }
}

/**
 * Prompt for instance type
 */
export async function getInstanceTypeInteractive(
  instanceType: string | undefined,
  defaultSKU: string,
  availableTypes: Array<{ sku: string; description: string }>,
): Promise<string> {
  // Check if provided and validate it
  if (instanceType) {
    return validateInstanceTypeSKU(instanceType, availableTypes);
  }

  // Determine default SKU if not provided
  const isCurrentType = defaultSKU !== "";
  if (defaultSKU === "" && availableTypes.length > 0) {
    defaultSKU = availableTypes[0].sku; // Use first from backend as default
  }

  // No option provided - show interactive prompt
  return selectInstanceTypeInteractively(
    availableTypes,
    defaultSKU,
    isCurrentType,
  );
}

/**
 * Prompt for app ID (supports app name or address)
 */
export interface GetAppIDOptions {
  appID?: string | Address;
  environment: string;
  privateKey?: string;
  rpcUrl?: string;
  action?: string; // e.g., "view logs for", "start", "stop", etc.
}

/**
 * Prompt for app ID (supports app name or address)
 */
export async function getOrPromptAppID(
  appIDOrOptions: string | Address | GetAppIDOptions | undefined,
  environment?: string,
): Promise<Address> {
  // Handle backward compatibility: if first arg is string/Address and second is string
  let options: GetAppIDOptions;
  if (environment !== undefined) {
    // Old signature: (appID, environment)
    options = {
      appID: appIDOrOptions as string | Address | undefined,
      environment: environment,
    };
  } else if (appIDOrOptions && typeof appIDOrOptions === "object" && "environment" in appIDOrOptions) {
    // New signature: (options)
    options = appIDOrOptions as GetAppIDOptions;
  } else {
    // Old signature but only one arg - treat as appID with default environment
    options = {
      appID: appIDOrOptions as string | Address | undefined,
      environment: "sepolia",
    };
  }

  // If provided, check if it's a name or address
  if (options.appID) {
    // Normalize the input
    const normalized = typeof options.appID === "string" ? addHexPrefix(options.appID) : options.appID;

    // Check if it's a valid address
    if (isAddress(normalized)) {
      return normalized as Address;
    }

    // If not a valid address, treat as app name and look it up
    const apps = listApps(options.environment);
    const foundAppID = apps[options.appID];
    if (foundAppID) {
      // Ensure it has 0x prefix
      return addHexPrefix(foundAppID) as Address;
    }

    // Name not found, but user provided something - return as-is and let validation happen later
    // Or we could throw an error here
    throw new Error(
      `App name '${options.appID}' not found in environment '${options.environment}'`,
    );
  }

  // No app ID provided, show interactive selection
  return getAppIDInteractive(options);
}

// Contract app status constants
const ContractAppStatusNone = 0;
const ContractAppStatusStarted = 1;
const ContractAppStatusStopped = 2;
const ContractAppStatusTerminated = 3;
const ContractAppStatusSuspended = 4;

/**
 * Get status string from contract status
 */
function getStatusString(status: number): string {
  switch (status) {
    case ContractAppStatusStarted:
      return "Started";
    case ContractAppStatusStopped:
      return "Stopped";
    case ContractAppStatusTerminated:
      return "Terminated";
    case ContractAppStatusSuspended:
      return "Suspended";
    default:
      return "Unknown";
  }
}

/**
 * Get status priority for sorting
 * Lower number = higher priority
 */
function getStatusPriority(status: number, isExited: boolean): number {
  if (isExited) {
    return 1; // Exited apps have high priority
  }
  switch (status) {
    case ContractAppStatusStarted:
      return 0; // Highest priority
    case ContractAppStatusStopped:
      return 2;
    case ContractAppStatusTerminated:
      return 3;
    default:
      return 4;
  }
}

/**
 * Format app display
 */
function formatAppDisplay(
  environmentName: string,
  appID: Address,
  profileName: string,
): string {
  if (profileName) {
    return `${profileName} (${environmentName}:${appID})`;
  }
  return `${environmentName}:${appID}`;
}

/**
 * Get app ID interactively
 * Queries contract and filters apps based on action
 */
async function getAppIDInteractive(
  options: GetAppIDOptions,
): Promise<Address> {
  const action = options.action || "view";
  const environment = options.environment || "sepolia";
  const environmentConfig = getEnvironmentConfig(environment);

  // If we don't have privateKey/rpcUrl, fall back to registry-based selection
  if (!options.privateKey || !options.rpcUrl) {
    return getAppIDInteractiveFromRegistry(environment, action);
  }

  console.log(`\nSelect an app to ${action}:\n`);

  // Get developer address from private key
  const privateKeyHex = addHexPrefix(options.privateKey);
  const account = privateKeyToAccount(privateKeyHex);
  const developerAddr = account.address;

  // Query contract for apps
  const { apps, appConfigs } = await getAllAppsByDeveloper(
    options.rpcUrl,
    environmentConfig,
    developerAddr,
  );

  if (apps.length === 0) {
    throw new Error("no apps found for your address");
  }

  // Get profile names from API for better display
  const profileNames: Record<string, string> = {};
  try {
    const userApiClient = new UserApiClient(
      environmentConfig,
      options.privateKey,
      options.rpcUrl,
    );
    const infos = await userApiClient.getInfos(apps, 1);
    for (const info of infos) {
      // Try to get profile name from API (if available in future)
      // For now, fall back to local registry
      const localName = getAppName(environment, info.address);
      if (localName) {
        profileNames[info.address.toLowerCase()] = localName;
      }
    }
  } catch (err) {
    // If API call fails, continue with local registry names only
  }

  // Also check local registry for profile names
  const localApps = listApps(environment);
  for (const [name, appID] of Object.entries(localApps)) {
    const normalizedID = appID.toLowerCase();
    if (!profileNames[normalizedID]) {
      profileNames[normalizedID] = name;
    }
  }

  // Determine which apps are eligible for the action
  const isEligible = (status: number): boolean => {
    switch (action) {
      case "view":
      case "set profile for":
        return true;
      case "start":
        return (
          status === ContractAppStatusStopped ||
          status === ContractAppStatusSuspended
        );
      case "stop":
        return status === ContractAppStatusStarted;
      default:
        // Default: exclude Terminated and Suspended
        return (
          status !== ContractAppStatusTerminated &&
          status !== ContractAppStatusSuspended
        );
    }
  };

  // Build app items with status
  interface AppItem {
    addr: Address;
    display: string;
    status: number;
    index: number;
  }

  const appItems: AppItem[] = [];
  for (let i = 0; i < apps.length; i++) {
    const appAddr = apps[i];
    const config = appConfigs[i];
    const status = config.status;

    if (!isEligible(status)) {
      continue;
    }

    const statusStr = getStatusString(status);
    const profileName = profileNames[appAddr.toLowerCase()] || "";
    const displayName = formatAppDisplay(
      environmentConfig.name,
      appAddr,
      profileName,
    );

    appItems.push({
      addr: appAddr,
      display: `${displayName} - ${statusStr}`,
      status,
      index: i,
    });
  }

  // Sort by status priority: Started > Stopped > Terminated
  // Within same status, show newest apps first (higher index = newer)
  appItems.sort((a, b) => {
    const aPriority = getStatusPriority(a.status, false);
    const bPriority = getStatusPriority(b.status, false);

    // First compare by status priority
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    // If same status, sort by index descending (newer apps first)
    return b.index - a.index;
  });

  if (appItems.length === 0) {
    switch (action) {
      case "start":
        throw new Error(
          "no startable apps found - only Stopped apps can be started",
        );
      case "stop":
        throw new Error(
          "no running apps found - only Running apps can be stopped",
        );
      default:
        throw new Error("no active apps found");
    }
  }

  // Build choices
  const choices = appItems.map((item) => ({
    name: item.display,
    value: item.addr,
  }));

  const selected = await select({
    message: "Select app:",
    choices,
  });

  return selected as Address;
}

/**
 * Fallback: Get app ID from local registry (used when contract query not available)
 */
async function getAppIDInteractiveFromRegistry(
  environment: string,
  action: string,
): Promise<Address> {
  const apps = listApps(environment);

  if (Object.keys(apps).length === 0) {
    // No apps in registry, prompt for manual input
    console.log("\nNo apps found in registry.");
    console.log("You can enter an app ID (address) or app name.");
    console.log();

    const appIDInput = await input({
      message: "Enter app ID or name:",
      default: "",
      validate: (value: string) => {
        if (!value) {
          return "App ID or name cannot be empty";
        }
        // Check if it's a valid address
        const normalized = addHexPrefix(value);
        if (isAddress(normalized)) {
          return true;
        }
        // Since apps is empty, only addresses are valid
        return "Invalid app ID address";
      },
    });

    // Resolve the input (validation already ensured it's a valid address)
    const normalized = addHexPrefix(appIDInput);
    if (isAddress(normalized)) {
      return normalized as Address;
    }
    // This shouldn't happen due to validation, but handle it anyway
    throw new Error(`Invalid app ID address: ${appIDInput}`);
  }

  // Build choices from registry
  const choices = Object.entries(apps).map(([name, appID]) => {
    const displayName = `${name} (${appID})`;
    return { name: displayName, value: appID };
  });

  // Add option to enter custom app ID
  choices.push({ name: "Enter custom app ID or name", value: "custom" });

  console.log(`\nSelect an app to ${action}:`);

  const selected = await select({
    message: "Choose app:",
    choices,
  });

  if (selected === "custom") {
    const appIDInput = await input({
      message: "Enter app ID or name:",
      default: "",
      validate: (value: string) => {
        if (!value) {
          return "App ID or name cannot be empty";
        }
        const normalized = addHexPrefix(value);
        if (isAddress(normalized)) {
          return true;
        }
        if (apps[value]) {
          return true;
        }
        return "Invalid app ID or name not found";
      },
    });

    const normalized = addHexPrefix(appIDInput);
    if (isAddress(normalized)) {
      return normalized as Address;
    }
    const foundAppID = apps[appIDInput];
    if (foundAppID) {
      return addHexPrefix(foundAppID) as Address;
    }
    throw new Error(`Failed to resolve app ID from input: ${appIDInput}`);
  }

  // Ensure selected app ID has 0x prefix
  return addHexPrefix(selected) as Address;
}

/**
 * Prompt for log settings
 */
export async function getLogSettingsInteractive(
  logVisibility?: "public" | "private" | "off",
): Promise<{ logRedirect: string; publicLogs: boolean }> {
  // Check if flag is provided
  if (logVisibility) {
    switch (logVisibility) {
      case "public":
        return { logRedirect: "always", publicLogs: true };
      case "private":
        return { logRedirect: "always", publicLogs: false };
      case "off":
        return { logRedirect: "", publicLogs: false };
      default:
        throw new Error(
          `invalid log-visibility value: ${logVisibility} (must be public, private, or off)`,
        );
    }
  }

  // Interactive prompt with three options
  const choice = await select({
    message: "Do you want to view your app's logs?",
    choices: [
      {
        name: "Yes, but only viewable by app and platform admins",
        value: "private",
      },
      { name: "Yes, publicly viewable by anyone", value: "public" },
      { name: "No, disable logs entirely", value: "off" },
    ],
  });

  switch (choice) {
    case "private":
      return { logRedirect: "always", publicLogs: false };
    case "public":
      return { logRedirect: "always", publicLogs: true };
    case "off":
      return { logRedirect: "", publicLogs: false };
    default:
      throw new Error(`Unexpected choice: ${choice}`);
  }
}

// Helper functions

interface RegistryInfo {
  Type: string;
  Username: string;
  URL: string;
}

/**
 * Get credentials from Docker credential helper
 */
async function getCredentialsFromHelper(
  registry: string,
): Promise<{ username: string; password: string } | undefined> {
  const dockerConfigPath = path.join(os.homedir(), ".docker", "config.json");

  if (!fs.existsSync(dockerConfigPath)) {
    return undefined;
  }

  try {
    const config = JSON.parse(fs.readFileSync(dockerConfigPath, "utf-8"));
    const credsStore = config.credsStore;

    if (!credsStore) {
      return undefined;
    }

    // Use Docker credential helper to get credentials
    // Format: docker-credential-<helper> get <serverURL>
    const { execSync } = await import("child_process");
    const helper = `docker-credential-${credsStore}`;

    try {
      // Try multiple registry URL formats that credential helpers might expect
      const registryVariants: string[] = [];

      // For Docker Hub, try multiple formats
      if (
        registry.includes("index.docker.io") ||
        registry.includes("docker.io")
      ) {
        registryVariants.push("https://index.docker.io/v1/");
        registryVariants.push("https://index.docker.io/v1");
        registryVariants.push("index.docker.io");
        registryVariants.push("docker.io");
      } else {
        // For other registries, try with and without https://
        const baseRegistry = registry
          .replace(/^https?:\/\//, "")
          .replace(/\/v1\/?$/, "")
          .replace(/\/$/, "");
        registryVariants.push(`https://${baseRegistry}`);
        registryVariants.push(`https://${baseRegistry}/v1/`);
        registryVariants.push(baseRegistry);
      }

      // Try each variant until one works
      for (const variant of registryVariants) {
        try {
          const output = execSync(`echo "${variant}" | ${helper} get`, {
            encoding: "utf-8",
          });
          const creds = JSON.parse(output);
          if (creds.Username && creds.Secret) {
            return { username: creds.Username, password: creds.Secret };
          }
        } catch {
          // Try next variant
          continue;
        }
      }
    } catch {
      // Credential helper failed, return undefined
      return undefined;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

async function getAvailableRegistries(): Promise<RegistryInfo[]> {
  const dockerConfigPath = path.join(os.homedir(), ".docker", "config.json");

  if (!fs.existsSync(dockerConfigPath)) {
    return [];
  }

  try {
    const configContent = fs.readFileSync(dockerConfigPath, "utf-8");
    const config = JSON.parse(configContent);

    // Docker config structure:
    // {
    //   "auths": {
    //     "https://index.docker.io/v1/": { "username": "...", "auth": "..." },
    //     "ghcr.io": { "username": "...", "auth": "..." },
    //     ...
    //   },
    //   "credsStore": "osxkeychain" (optional - credentials stored in helper)
    // }
    const auths = config.auths || {};
    const credsStore = config.credsStore;
    const gcrProjects = new Map<string, RegistryInfo>();
    const registries: RegistryInfo[] = [];

    for (const [registry, auth] of Object.entries(auths)) {
      const authData = auth as { username?: string; auth?: string };

      // Skip access-token and refresh-token entries for Docker Hub
      if (
        registry.includes("access-token") ||
        registry.includes("refresh-token")
      ) {
        continue;
      }

      let username = authData.username;
      let registryType = "other";
      let normalizedURL = registry;

      // Determine registry type and normalize URL
      if (
        registry.includes("index.docker.io") ||
        registry.includes("docker.io")
      ) {
        registryType = "dockerhub";
        normalizedURL = "https://index.docker.io/v1/";
      } else if (registry.includes("ghcr.io")) {
        registryType = "ghcr";
        // Normalize ghcr.io variants
        normalizedURL = registry.replace(/^https?:\/\//, "").replace(/\/v1\/?$/, "");
      } else if (registry.includes("gcr.io") || registry.includes(".gcr.io")) {
        registryType = "gcr";
        normalizedURL = "gcr.io"; // Normalize to canonical URL
      }

      // If no username in config but credsStore is configured, try to get from helper
      if (!username && credsStore) {
        const creds = await getCredentialsFromHelper(registry);
        if (creds) {
          username = creds.username;
        }
      }

      // Skip if we still don't have a username
      if (!username) {
        continue;
      }

      const info: RegistryInfo = {
        URL: normalizedURL,
        Username: username,
        Type: registryType,
      };

      // Handle GCR deduplication
      if (registryType === "gcr") {
        if (!gcrProjects.has(username)) {
          gcrProjects.set(username, info);
        }
        continue; // Skip adding now, add deduplicated later
      }

      registries.push(info);
    }

    // Add deduplicated GCR entries
    for (const gcrInfo of gcrProjects.values()) {
      registries.push(gcrInfo);
    }

    // Sort registries with Docker Hub first
    registries.sort((a, b) => {
      if (a.Type === "dockerhub") return -1;
      if (b.Type === "dockerhub") return 1;
      return a.Type.localeCompare(b.Type);
    });

    return registries;
  } catch {
    // If config is invalid or can't be read, return empty array
    return [];
  }
}

function displayDetectedRegistries(
  registries: RegistryInfo[],
  appName: string,
): void {
  console.log("Detected authenticated registries:");
  for (const reg of registries) {
    const suggestion = suggestImageReference(reg, appName, "latest");
    console.log(`  ${reg.Type}: ${suggestion}`);
  }
  console.log();
}

function displayAuthenticationInstructions(): void {
  console.log("No authenticated registries detected.");
  console.log("To authenticate:");
  console.log("  docker login <registry-url>");
  console.log();
}

function displayRegistryExamples(appName: string): void {
  console.log("Examples:");
  console.log(`  docker.io/${appName.toLowerCase()}:latest`);
  console.log(`  ghcr.io/username/${appName.toLowerCase()}:latest`);
  console.log(`  gcr.io/project-id/${appName.toLowerCase()}:latest`);
  console.log();
}

async function selectRegistryInteractive(
  registries: RegistryInfo[],
  imageName: string,
  tag: string,
): Promise<string> {
  if (registries.length === 1) {
    // Single registry - suggest it as default
    const defaultRef = suggestImageReference(registries[0], imageName, tag);
    return input({
      message: "Enter image reference:",
      default: defaultRef,
      validate: validateImageReference,
    });
  }

  // Multiple registries - let user choose
  const choices = registries.map((reg) => ({
    name: suggestImageReference(reg, imageName, tag),
    value: suggestImageReference(reg, imageName, tag),
  }));
  choices.push({ name: "Enter custom image reference", value: "custom" });

  const choice = await select({
    message: "Select image destination:",
    choices,
  });

  if (choice === "custom") {
    return input({
      message: "Enter image reference:",
      default: "",
      validate: validateImageReference,
    });
  }

  return choice;
}

function suggestImageReference(
  registry: RegistryInfo,
  imageName: string,
  tag: string,
): string {
  // Clean up image name for use in image reference
  imageName = imageName.toLowerCase().replace(/_/g, "-");

  // Default to latest if no tag provided
  if (!tag) {
    tag = "latest";
  }

  switch (registry.Type) {
    case "dockerhub":
      return `${registry.Username}/${imageName}:${tag}`;
    case "ghcr":
      return `ghcr.io/${registry.Username}/${imageName}:${tag}`;
    case "gcr":
      return `gcr.io/${registry.Username}/${imageName}:${tag}`;
    default:
      // For other registries, try to construct a reasonable default
      let host = registry.URL;
      if (host.startsWith("https://")) {
        host = host.substring(8);
      } else if (host.startsWith("http://")) {
        host = host.substring(7);
      }
      host = host.replace(/\/$/, "");
      return `${host}/${registry.Username}/${imageName}:${tag}`;
  }
}

function getDefaultAppName(): string {
  try {
    return path.basename(process.cwd());
  } catch {
    return "myapp";
  }
}

export function extractAppNameFromImage(imageRef: string): string {
  // Remove registry prefix if present
  const parts = imageRef.split("/");
  let imageName = parts.length > 1 ? parts[parts.length - 1] : imageRef;

  // Split image and tag
  if (imageName.includes(":")) {
    imageName = imageName.split(":")[0];
  }

  return imageName;
}

function findAvailableName(environment: string, baseName: string): string {
  const apps = listApps(environment);

  // Check if base name is available
  if (!apps[baseName]) {
    return baseName;
  }

  // Try with incrementing numbers
  for (let i = 2; i <= 100; i++) {
    const candidate = `${baseName}-${i}`;
    if (!apps[candidate]) {
      return candidate;
    }
  }

  // Fallback to timestamp if somehow we have 100+ duplicates
  return `${baseName}-${Date.now()}`;
}

function isAppNameAvailable(environment: string, name: string): boolean {
  const apps = listApps(environment);
  return !apps[name];
}

function validateAppName(name: string): void {
  if (!name) {
    throw new Error("App name cannot be empty");
  }
  if (name.includes(" ")) {
    throw new Error("App name cannot contain spaces");
  }
  if (name.length > 50) {
    throw new Error("App name cannot be longer than 50 characters");
  }
}

function validateImageReference(value: string): boolean | string {
  if (!value) {
    return "Image reference cannot be empty";
  }
  // Basic validation - should contain at least one / and optionally :
  if (!value.includes("/")) {
    return "Image reference must contain at least one /";
  }
  return true;
}

function validateFilePath(value: string): boolean | string {
  if (!value) {
    return "File path cannot be empty";
  }
  if (!fs.existsSync(value)) {
    return "File does not exist";
  }
  return true;
}

function validateInstanceTypeSKU(
  sku: string,
  availableTypes: Array<{ sku: string }>,
): string {
  // Check if SKU is valid
  for (const it of availableTypes) {
    if (it.sku === sku) {
      return sku;
    }
  }

  // Build helpful error message with valid options
  const validSKUs = availableTypes.map((it) => it.sku).join(", ");
  throw new Error(
    `invalid instance-type value: ${sku} (must be one of: ${validSKUs})`,
  );
}

async function selectInstanceTypeInteractively(
  availableTypes: Array<{ sku: string; description: string }>,
  defaultSKU: string,
  isCurrentType: boolean,
): Promise<string> {
  // Show header based on context
  if (isCurrentType && defaultSKU) {
    console.log(`\nSelect instance type (current: ${defaultSKU}):`);
  } else {
    console.log("\nSelect instance type:");
  }

  // Build options
  const choices = availableTypes.map((it) => {
    let name = `${it.sku} - ${it.description}`;
    // Mark the default/current option
    if (it.sku === defaultSKU) {
      name += isCurrentType ? " (current)" : " (default)";
    }
    return { name, value: it.sku };
  });

  const choice = await select({
    message: "Choose instance:",
    choices,
  });

  return choice;
}

/**
 * Confirm prompts the user to confirm an action with a yes/no question.
 */
export async function confirm(prompt: string): Promise<boolean> {
  return confirmWithDefault(prompt, false);
}

/**
 * ConfirmWithDefault prompts the user to confirm an action with a yes/no question and a default value.
 */
export async function confirmWithDefault(
  prompt: string,
  defaultValue: boolean = false,
): Promise<boolean> {
  return await inquirerConfirm({
    message: prompt,
    default: defaultValue,
  });
}

/**
 * Validate private key format
 * Matches Go's common.ValidatePrivateKey() function
 */
function validatePrivateKeyFormat(key: string): boolean {
  // Remove 0x prefix if present
  const keyWithoutPrefix = stripHexPrefix(key);

  // Must be 64 hex characters (32 bytes)
  if (!/^[0-9a-fA-F]{64}$/.test(keyWithoutPrefix)) {
    return false;
  }

  return true;
}

/**
 * Prompt for RPC URL
 * Matches Go's getRPCURL() behavior with interactive prompt
 */
export async function getRPCUrlInteractive(
  rpcUrl?: string,
  defaultRpcUrl?: string,
): Promise<string> {
  // If provided, return it
  if (rpcUrl) {
    return rpcUrl;
  }

  // Use default if available
  const defaultValue = defaultRpcUrl || "";

  const url = await input({
    message: "Enter RPC URL:",
    default: defaultValue,
    validate: (value: string) => {
      if (!value.trim()) {
        return "RPC URL is required";
      }
      // Basic URL validation
      try {
        new URL(value);
        return true;
      } catch {
        return "Invalid URL format";
      }
    },
  });

  return url.trim();
}

/**
 * Prompt for environment selection
 * Matches Go's GetEnvironmentConfig() behavior with interactive prompt
 */
export async function getEnvironmentInteractive(
  environment?: string,
): Promise<string> {
  // If provided, validate and return it
  if (environment) {
    try {
      getEnvironmentConfig(environment);
      // Also check if it's available in current build
      if (!isEnvironmentAvailable(environment)) {
        throw new Error(`Environment ${environment} is not available in this build`);
      }
      return environment;
    } catch {
      // Invalid environment, continue to prompt
    }
  }

  // Get available environments based on build type
  const availableEnvs = getAvailableEnvironments();
  
  // Build choices based on available environments
  const choices = [];
  if (availableEnvs.includes("sepolia")) {
    choices.push({
      name: "sepolia - Ethereum Sepolia testnet",
      value: "sepolia",
    });
  }
  if (availableEnvs.includes("sepolia-dev")) {
    choices.push({
      name: "sepolia-dev - Ethereum Sepolia testnet (dev)",
      value: "sepolia-dev",
    });
  }
  if (availableEnvs.includes("mainnet-alpha")) {
    choices.push({
      name: "mainnet-alpha - Ethereum mainnet (⚠️  uses real funds)",
      value: "mainnet-alpha",
    });
  }

  if (choices.length === 0) {
    throw new Error("No environments available in this build");
  }

  const env = await select({
    message: "Select environment:",
    choices,
  });

  return env;
}

/**
 * Prompt for private key with hidden input
 * Matches Go's output.InputHiddenString() function
 */
export async function getPrivateKeyInteractive(
  privateKey?: string,
): Promise<string> {
  // If provided, validate and return it
  if (privateKey) {
    if (!validatePrivateKeyFormat(privateKey)) {
      throw new Error("Invalid private key format");
    }
    return privateKey;
  }

  const key = await password({
    message: "Enter private key:",
    mask: true,
    validate: (value: string) => {
      if (!value.trim()) {
        return "Private key is required";
      }
      if (!validatePrivateKeyFormat(value)) {
        return "Invalid private key format (must be 64 hex characters, optionally prefixed with 0x)";
      }
      return true;
    },
  });

  return key.trim();
}

/**
 * Profile collection functions
 */

import { AppProfile } from "../types";

const MAX_APP_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4MB
const VALID_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png"];
const VALID_X_HOSTS = [
  "twitter.com",
  "www.twitter.com",
  "x.com",
  "www.x.com",
];

/**
 * Collect app profile information interactively
 * If defaultName is provided, it will be used as the suggested name
 * If allowRetry is true, user can re-enter information on rejection (deploy flow)
 * If allowRetry is false, rejection returns an error (profile set flow)
 */
export async function getAppProfileInteractive(
  defaultName: string = "",
  allowRetry: boolean = true,
): Promise<AppProfile | null> {
  while (true) {
    // Collect name (required)
    const name = await getAppNameForProfile(defaultName);

    // Collect optional fields
    const website = await getAppWebsiteInteractive();
    const description = await getAppDescriptionInteractive();
    const xURL = await getAppXURLInteractive();
    const imagePath = await getAppImageInteractive();

    const profile: AppProfile = {
      name,
      website,
      description,
      xURL,
      imagePath,
    };

    // Display profile for confirmation
    console.log("\n" + formatProfileForDisplay(profile));

    const confirmed = await inquirerConfirm({
      message: "Continue with this profile?",
      default: true,
    });

    if (confirmed) {
      return profile;
    }

    // User rejected the profile
    if (!allowRetry) {
      throw new Error("Profile confirmation cancelled");
    }

    // Deploy flow: ask if they want to re-enter
    const retry = await inquirerConfirm({
      message: "Would you like to re-enter the information?",
      default: true,
    });

    if (!retry) {
      // User doesn't want to set a profile - skip it entirely
      return null;
    }

    // Loop back to re-collect information (keep the name)
    defaultName = name;
  }
}

/**
 * Get app name for profile (reuses existing validation)
 */
async function getAppNameForProfile(defaultName: string): Promise<string> {
  if (defaultName) {
    validateAppName(defaultName);
    return defaultName;
  }

  return await input({
    message: "App name:",
    default: "",
    validate: (value: string) => {
      if (!value.trim()) {
        return "Name is required";
      }
      try {
        validateAppName(value);
        return true;
      } catch (err: any) {
        return err.message;
      }
    },
  });
}

/**
 * Get website URL interactively
 */
async function getAppWebsiteInteractive(): Promise<string | undefined> {
  const website = await input({
    message: "Website URL (optional):",
    default: "",
    validate: (value: string) => {
      if (!value.trim()) {
        return true; // Optional
      }
      const err = validateURL(value);
      return err ? err : true;
    },
  });

  if (!website.trim()) {
    return undefined;
  }

  return sanitizeURL(website);
}

/**
 * Get description interactively
 */
async function getAppDescriptionInteractive(): Promise<string | undefined> {
  const description = await input({
    message: "Description (optional):",
    default: "",
    validate: (value: string) => {
      if (!value.trim()) {
        return true; // Optional
      }
      const err = validateDescription(value);
      return err ? err : true;
    },
  });

  if (!description.trim()) {
    return undefined;
  }

  return sanitizeString(description);
}

/**
 * Get X (Twitter) URL interactively
 */
async function getAppXURLInteractive(): Promise<string | undefined> {
  const xURL = await input({
    message: "X (Twitter) URL (optional):",
    default: "",
    validate: (value: string) => {
      if (!value.trim()) {
        return true; // Optional
      }
      const err = validateXURL(value);
      return err ? err : true;
    },
  });

  if (!xURL.trim()) {
    return undefined;
  }

  return sanitizeXURL(xURL);
}

/**
 * Get app image interactively
 */
async function getAppImageInteractive(): Promise<string | undefined> {
  const wantsImage = await inquirerConfirm({
    message: "Would you like to upload an app icon/logo?",
    default: false,
  });

  if (!wantsImage) {
    return undefined;
  }

  const imagePath = await input({
    message:
      "Image path (drag & drop image file or enter path - JPG/PNG, max 4MB, square recommended):",
    default: "",
    validate: (value: string) => {
      if (!value.trim()) {
        return true; // Optional
      }
      const err = validateImagePath(value);
      return err ? err : true;
    },
  });

  if (!imagePath.trim()) {
    return undefined;
  }

  // Validate and get image info
  const cleanedPath = imagePath.trim().replace(/^["']|["']$/g, "");
  const imgInfo = await getImageInfo(cleanedPath);
  if (imgInfo) {
    console.log(
      `📸 Image: ${imgInfo.width}x${imgInfo.height} pixels, ${imgInfo.sizeKB.toFixed(1)} KB`,
    );
    if (!imgInfo.isSquare) {
      const ratio = imgInfo.aspectRatio.toFixed(2);
      console.log(
        `⚠️  Note: Image is not square (${ratio}:1 ratio). Square images display best.`,
      );
    }
  }

  return cleanedPath;
}

/**
 * Format profile for display
 */
function formatProfileForDisplay(profile: AppProfile): string {
  let output = "\n📋 Profile Summary:\n";
  output += `  Name:        ${profile.name}\n`;
  if (profile.website) {
    output += `  Website:     ${profile.website}\n`;
  }
  if (profile.description) {
    output += `  Description: ${profile.description}\n`;
  }
  if (profile.xURL) {
    output += `  X URL:       ${profile.xURL}\n`;
  }
  if (profile.imagePath) {
    output += `  Image:       ${profile.imagePath}\n`;
  }
  return output;
}

/**
 * Validation functions
 */

function validateURL(rawURL: string): string | undefined {
  if (!rawURL.trim()) {
    return "URL cannot be empty";
  }

  try {
    const url = new URL(rawURL);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "URL scheme must be http or https";
    }
  } catch {
    return "Invalid URL format";
  }

  return undefined;
}

function validateXURL(rawURL: string): string | undefined {
  // First validate as URL
  const urlErr = validateURL(rawURL);
  if (urlErr) {
    return urlErr;
  }

  try {
    const url = new URL(rawURL);
    const host = url.hostname.toLowerCase();

    // Accept twitter.com and x.com domains
    if (!VALID_X_HOSTS.includes(host)) {
      return "URL must be a valid X/Twitter URL (x.com or twitter.com)";
    }

    // Ensure it has a path (username/profile)
    if (!url.pathname || url.pathname === "/") {
      return "X URL must include a username or profile path";
    }
  } catch {
    return "Invalid X URL format";
  }

  return undefined;
}

function validateDescription(description: string): string | undefined {
  if (!description.trim()) {
    return "Description cannot be empty";
  }

  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return `Description cannot exceed ${MAX_DESCRIPTION_LENGTH} characters`;
  }

  return undefined;
}

function validateImagePath(filePath: string): string | undefined {
  // Strip quotes that may be added by terminal drag-and-drop
  const cleanedPath = filePath.trim().replace(/^["']|["']$/g, "");

  if (!cleanedPath) {
    return "Image path cannot be empty";
  }

  // Check if file exists
  if (!fs.existsSync(cleanedPath)) {
    return `Image file not found: ${cleanedPath}`;
  }

  const stats = fs.statSync(cleanedPath);
  if (stats.isDirectory()) {
    return "Path is a directory, not a file";
  }

  // Check file size
  if (stats.size > MAX_IMAGE_SIZE) {
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    return `Image file size (${sizeMB} MB) exceeds maximum allowed size of 4 MB`;
  }

  // Check file extension
  const ext = path.extname(cleanedPath).toLowerCase();
  if (!VALID_IMAGE_EXTENSIONS.includes(ext)) {
    return "Image must be JPG or PNG format";
  }

  return undefined;
}

interface ImageInfo {
  width: number;
  height: number;
  sizeKB: number;
  aspectRatio: number;
  isSquare: boolean;
}

async function getImageInfo(
  filePath: string,
): Promise<ImageInfo | null> {
  try {
    const stats = fs.statSync(filePath);
    const sizeKB = stats.size / 1024;

    // Read file buffer to parse image dimensions
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();

    let width = 0;
    let height = 0;

    if (ext === ".png") {
      // PNG format: width and height are at bytes 16-23 (4 bytes each, big-endian)
      if (buffer.length >= 24) {
        width = buffer.readUInt32BE(16);
        height = buffer.readUInt32BE(20);
      }
    } else if (ext === ".jpg" || ext === ".jpeg") {
      // JPEG format: dimensions are in SOF (Start of Frame) markers
      // Look for SOF markers: 0xFFC0, 0xFFC1, 0xFFC2, etc.
      let i = 0;
      while (i < buffer.length - 1) {
        if (buffer[i] === 0xff && buffer[i + 1] >= 0xc0 && buffer[i + 1] <= 0xc3) {
          // Found SOF marker, height and width are at offset +5 and +7 (2 bytes each, big-endian)
          if (i + 9 < buffer.length) {
            height = buffer.readUInt16BE(i + 5);
            width = buffer.readUInt16BE(i + 7);
            break;
          }
        }
        i++;
      }
    }

    const aspectRatio = height > 0 ? width / height : 1;
    const isSquare = aspectRatio >= 0.8 && aspectRatio <= 1.25;

    return {
      width,
      height,
      sizeKB,
      aspectRatio,
      isSquare,
    };
  } catch {
    return null;
  }
}

/**
 * Sanitization functions
 */

function sanitizeString(s: string): string {
  // HTML escape and trim
  return s
    .trim()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeURL(rawURL: string): string {
  rawURL = rawURL.trim();

  // Add https:// if no scheme is present
  if (!hasScheme(rawURL)) {
    rawURL = "https://" + rawURL;
  }

  // Validate
  const err = validateURL(rawURL);
  if (err) {
    throw new Error(err);
  }

  return rawURL;
}

function sanitizeXURL(rawURL: string): string {
  rawURL = rawURL.trim();

  // Handle username-only input (e.g., "@username" or "username")
  if (!rawURL.includes("://") && !rawURL.includes(".")) {
    // Remove @ if present
    const username = rawURL.startsWith("@") ? rawURL.slice(1) : rawURL;
    rawURL = `https://x.com/${username}`;
  } else if (!hasScheme(rawURL)) {
    // Add https:// if URL-like but missing scheme
    rawURL = "https://" + rawURL;
  }

  // Normalize twitter.com to x.com
  rawURL = rawURL.replace(/twitter\.com/g, "x.com");
  rawURL = rawURL.replace(/www\.x\.com/g, "x.com");

  // Validate
  const err = validateXURL(rawURL);
  if (err) {
    throw new Error(err);
  }

  return rawURL;
}

function hasScheme(rawURL: string): boolean {
  return rawURL.startsWith("http://") || rawURL.startsWith("https://");
}
