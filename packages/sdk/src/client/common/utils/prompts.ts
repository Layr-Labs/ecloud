/**
 * Interactive prompts using @inquirer/prompts
 */

import { input, select } from "@inquirer/prompts";
import fs from "fs";
import path from "path";
import os from "os";
import { Address, isAddress } from "viem";
import { listApps } from "../registry/appNames";

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
  availableTypes: Array<{ sku: string; Description: string }>,
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
export async function getOrPromptAppID(
  appID: string | Address | undefined,
  environment: string,
): Promise<Address> {
  // If provided, check if it's a name or address
  if (appID) {
    // Normalize the input
    const normalized = typeof appID === "string" 
      ? (appID.startsWith("0x") ? appID : `0x${appID}`)
      : appID;

    // Check if it's a valid address
    if (isAddress(normalized)) {
      return normalized as Address;
    }

    // If not a valid address, treat as app name and look it up
    const apps = listApps(environment);
    const foundAppID = apps[appID];
    if (foundAppID) {
      // Ensure it has 0x prefix
      return foundAppID.startsWith("0x") 
        ? (foundAppID as Address)
        : (`0x${foundAppID}` as Address);
    }

    // Name not found, but user provided something - return as-is and let validation happen later
    // Or we could throw an error here
    throw new Error(`App name '${appID}' not found in environment '${environment}'`);
  }

  // No app ID provided, show interactive selection
  return getAppIDInteractive(environment);
}

/**
 * Get app ID interactively
 */
async function getAppIDInteractive(environment: string): Promise<Address> {
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
        const normalized = value.startsWith("0x") ? value : `0x${value}`;
        if (isAddress(normalized)) {
          return true;
        }
        // Since apps is empty, only addresses are valid
        return "Invalid app ID address";
      },
    });

    // Resolve the input (validation already ensured it's a valid address)
    const normalized = appIDInput.startsWith("0x") ? appIDInput : `0x${appIDInput}`;
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

  console.log("\nSelect an app to upgrade:");

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
        const normalized = value.startsWith("0x") ? value : `0x${value}`;
        if (isAddress(normalized)) {
          return true;
        }
        if (apps[value]) {
          return true;
        }
        return "Invalid app ID or name not found";
      },
    });

    const normalized = appIDInput.startsWith("0x") ? appIDInput : `0x${appIDInput}`;
    if (isAddress(normalized)) {
      return normalized as Address;
    }
    const foundAppID = apps[appIDInput];
    if (foundAppID) {
      return foundAppID.startsWith("0x") 
        ? (foundAppID as Address)
        : (`0x${foundAppID}` as Address);
    }
    throw new Error(`Failed to resolve app ID from input: ${appIDInput}`);
  }

  // Ensure selected app ID has 0x prefix
  return selected.startsWith("0x") 
    ? (selected as Address)
    : (`0x${selected}` as Address);
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
    //   }
    // }
    const auths = config.auths || {};
    const gcrProjects = new Map<string, RegistryInfo>();
    const registries: RegistryInfo[] = [];

    for (const [registry, auth] of Object.entries(auths)) {
      const authData = auth as { username?: string; auth?: string };
      if (!authData.username) {
        continue;
      }

      const info: RegistryInfo = {
        URL: registry,
        Username: authData.username,
        Type: "other",
      };

      // Determine registry type
      if (
        registry.includes("index.docker.io") ||
        registry.includes("docker.io")
      ) {
        // Skip access-token and refresh-token entries for Docker Hub
        if (
          registry.includes("access-token") ||
          registry.includes("refresh-token")
        ) {
          continue;
        }
        info.Type = "dockerhub";
        info.URL = "https://index.docker.io/v1/"; // Normalize
      } else if (registry.includes("ghcr.io")) {
        info.Type = "ghcr";
      } else if (registry.includes("gcr.io") || registry.includes(".gcr.io")) {
        info.Type = "gcr";
        // Deduplicate GCR registries - regional endpoints point to same storage
        if (!gcrProjects.has(authData.username)) {
          info.URL = "gcr.io"; // Normalize to canonical URL
          gcrProjects.set(authData.username, info);
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

function extractAppNameFromImage(imageRef: string): string {
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
  availableTypes: Array<{ sku: string; Description: string }>,
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
    let name = `${it.sku}`; // - ${it.Description}
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
