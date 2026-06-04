/**
 * Interactive prompts for CLI commands
 *
 * This module contains all interactive user prompts. These functions should only
 * be used in CLI commands, not in the SDK.
 */

import { input, select, password, confirm as inquirerConfirm } from "@inquirer/prompts";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import os from "os";
import { Address, Hex, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  getEnvironmentConfig,
  getAvailableEnvironments,
  getAllAppsByDeveloper,
  getCategoryDescriptions,
  fetchTemplateCatalog,
  PRIMARY_LANGUAGES,
  AppProfile,
  validateAppName,
  validateImageReference,
  validateFilePath,
  validatePrivateKeyFormat,
  extractAppNameFromImage,
  type Build,
  type BuildModule,
  UserApiClient,
} from "@layr-labs/ecloud-sdk";
import { getAppInfosChunked } from "./appResolver";
import { createViemClients } from "./viemClients";
import {
  getDefaultEnvironment,
  getProfileCache,
  setProfileCache,
  getLinkedAppForDirectory,
} from "./globalConfig";
import { listApps, isAppNameAvailable, findAvailableName } from "./appNames";
import { execSync } from "child_process";
import { getClientId } from "./version";

// Helper to add hex prefix
function addHexPrefix(value: string): Hex {
  if (value.startsWith("0x")) {
    return value as Hex;
  }
  return `0x${value}`;
}

/**
 * Ensure the terminal is interactive before prompting.
 * In non-TTY environments (CI, agents), @inquirer/prompts throws an opaque
 * ExitPromptError. This gives a clear, actionable error instead.
 */
function ensureInteractive(missingFlagHint: string): void {
  if (!process.stdin.isTTY) {
    throw new Error(
      `Cannot prompt in non-interactive mode. Provide ${missingFlagHint} via CLI flags or environment variables.`,
    );
  }
}

/**
 * True when the CLI should run without interactive prompts.
 *
 * Precedence: an explicit `--non-interactive` flag, then `CI=true`, then the
 * absence of a TTY. `isTTY` alone is unreliable in pipes/CI, so the flag and CI
 * env give callers (agents, scripts) a deterministic signal.
 *
 * The optional deploy/upgrade prompts (env file, log visibility, resource-usage
 * monitoring, Dockerfile-vs-existing-image, instance type) all have a safe
 * default, so rather than throwing via `ensureInteractive` they fall back to
 * that default and log what was chosen. Required inputs with no safe default
 * (image source, app name/id) are reported all-at-once by the command layer.
 */
export function isNonInteractive(flags?: { "non-interactive"?: boolean }): boolean {
  if (flags?.["non-interactive"]) return true;
  if (process.env.CI === "true") return true;
  return !process.stdin.isTTY;
}

/**
 * Emit a single, consistent line noting that an optional flag was defaulted
 * because we are running without a TTY. Keeps the choice visible/auditable in
 * CI logs.
 */
function warnDefaulted(flagHint: string, chosen: string): void {
  console.warn(`Warning: ${flagHint} not set in non-interactive mode; defaulting to ${chosen}.`);
}

/** The set of required deploy/upgrade inputs that have no safe default. */
export interface RequiredInputState {
  imageRef?: string;
  dockerfile?: string;
  verifiable?: boolean;
  repo?: string;
  commit?: string;
  name?: string;
}

/**
 * Collect ALL missing required deploy/upgrade inputs for non-interactive mode,
 * so the caller can report them in one error instead of one prompt at a time.
 *
 * Covers the image source (and, for deploy, `--name`). The upgrade `app-id` is
 * a positional arg, so its presence is checked at the call site; this helper
 * only reports the image-source half for `"app-id"` callers.
 *
 * @param identityFlag "name" for deploy, "app-id" for upgrade.
 */
export function collectMissingRequiredInputs(
  state: RequiredInputState,
  identityFlag: "name" | "app-id",
): string[] {
  const missing: string[] = [];
  const hasImageSource =
    !!state.imageRef ||
    !!state.dockerfile ||
    (!!state.verifiable && !!state.repo && !!state.commit);
  if (!hasImageSource) {
    missing.push(
      "an image source (one of: --image-ref, --dockerfile, or --verifiable with --repo and --commit)",
    );
  }
  if (identityFlag === "name" && !state.name) {
    missing.push("--name");
  }
  return missing;
}

// ==================== Dockerfile Selection ====================

/**
 * Resolve the Dockerfile path: explicit flag, else the discovered ./Dockerfile.
 * When nonInteractive, defaults instead of prompting for build-vs-existing.
 */
export async function getDockerfile(
  dockerfilePath?: string,
  nonInteractive: boolean = false,
): Promise<string> {
  // Check if provided via option
  if (dockerfilePath) {
    return dockerfilePath;
  }

  // Check if default Dockerfile exists in current directory
  // Use INIT_CWD if available (set by npm/pnpm to original cwd), otherwise fall back to process.cwd()
  const cwd = process.env.INIT_CWD || process.cwd();
  const dockerfilePath_resolved = path.join(cwd, "Dockerfile");

  if (!fs.existsSync(dockerfilePath_resolved)) {
    // No Dockerfile found, return empty string (deploy existing image)
    return "";
  }

  // In non-interactive mode we cannot ask the user to choose between building
  // the discovered Dockerfile and deploying an existing image. Default to
  // building from the discovered Dockerfile — the intent when a Dockerfile is
  // sitting in the working directory. Callers that pass --image-ref skip this
  // helper entirely (see deploy.ts / upgrade.ts), so this default never
  // overrides an explicit image reference.
  if (nonInteractive) {
    warnDefaulted("--dockerfile/--image-ref", `build from '${dockerfilePath_resolved}'`);
    return dockerfilePath_resolved;
  }

  // Interactive prompt when Dockerfile exists
  ensureInteractive("--dockerfile or --image-ref");
  console.log(`\nFound Dockerfile in ${cwd}`);

  const choice = await select({
    message: "Choose deployment method:",
    choices: [
      { name: "Build and deploy from Dockerfile", value: "build" },
      { name: "Deploy existing image from registry", value: "existing" },
    ],
  });

  switch (choice) {
    case "build":
      // Return full path so SDK uses the correct directory
      return dockerfilePath_resolved;
    case "existing":
      return "";
    default:
      throw new Error(`Unexpected choice: ${choice}`);
  }
}

// ==================== Verifiable Build (Interactive) ====================

export type VerifiableSourceType = "git" | "prebuilt";

export interface VerifiableGitSourceInputs {
  repoUrl: string;
  gitRef: string;
  dockerfilePath: string;
  caddyfilePath?: string;
  buildContextPath: string;
  dependencies: string[];
}

// Helper to detect current git repo URL and HEAD commit
function detectGitRepoInfo(): { repoUrl?: string; commitSha?: string } {
  const git = (cmd: string) =>
    execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();

  const detectRepoUrl = (): string | undefined => {
    try {
      const remote = git("git remote get-url origin")
        .replace(/^git@github\.com:(.+?)(?:\.git)?$/, "https://github.com/$1")
        .replace(/\.git$/, "");
      if (/^https:\/\/github\.com\/[^/]+\/[^/]+/.test(remote)) return remote;
    } catch {}
  };

  const detectCommitSha = (): string | undefined => {
    try {
      const branch = git("git rev-parse --abbrev-ref HEAD");
      if (!branch || branch === "HEAD") return;
      const lsRemote = git(`git ls-remote origin refs/heads/${branch}`);
      return lsRemote.match(/^([0-9a-f]{40})\s/i)?.[1];
    } catch {}
  };

  try {
    return { repoUrl: detectRepoUrl(), commitSha: detectCommitSha() };
  } catch {
    return {};
  }
}

/**
 * Prompt: "Build from verifiable source?" (only used when --verifiable is not set)
 *
 * When `force` is true (i.e. the user passed --force), skip the prompt entirely
 * and return the default answer (false = regular build). Without this short-circuit,
 * `confirmWithDefault` throws in non-interactive mode, which means --force on an
 * image-ref-only deploy or upgrade was unusable in CI.
 */
export async function promptUseVerifiableBuild(force: boolean = false): Promise<boolean> {
  if (force) return false;
  return confirmWithDefault("Build from verifiable source?", false);
}

/**
 * Prompt: select verifiable build source type
 */
export async function promptVerifiableSourceType(): Promise<VerifiableSourceType> {
  ensureInteractive("--verifiable with --repo/--commit or --image-ref");
  return select({
    message: "Choose verifiable source type:",
    choices: [
      { name: "Build from git source (public repo required)", value: "git" },
      { name: "Use a prebuilt verifiable image (eigencloud-containers)", value: "prebuilt" },
    ],
  });
}

/**
 * Prompt for Git-source verifiable build inputs.
 */
export async function promptVerifiableGitSourceInputs(): Promise<VerifiableGitSourceInputs> {
  ensureInteractive("--repo, --commit");
  const detected = detectGitRepoInfo();

  const repoUrl = (
    await input({
      message: "Enter public git repository URL:",
      default: detected.repoUrl ?? "",
      validate: (value) => {
        if (!value.trim()) return "Repository URL is required";
        try {
          // Restrict to GitHub HTTPS URLs since verifiable builds require a public repo.
          const url = new URL(value.trim());
          if (url.protocol !== "https:") return "Repository URL must start with https://";
          if (url.hostname.toLowerCase() !== "github.com")
            return "Repository URL must be a public GitHub HTTPS URL (github.com)";

          // Require at least /owner/repo
          const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
          if (parts.length < 2) return "Repository URL must be https://github.com/<owner>/<repo>";

          // Disallow obvious non-repo paths
          const [owner, repo] = parts;
          if (!owner || !repo) return "Repository URL must be https://github.com/<owner>/<repo>";
          if (repo.toLowerCase() === "settings") return "Repository URL looks invalid";

          // Disallow fragments/query
          if (url.search || url.hash)
            return "Repository URL must not include query params or fragments";

          // Allow optional .git suffix; otherwise accept as-is.
        } catch {
          return "Invalid URL format";
        }
        return true;
      },
    })
  ).trim();

  const gitRef = (
    await input({
      message: "Enter git commit SHA (40 hex chars):",
      default: repoUrl === detected.repoUrl ? (detected.commitSha ?? "") : "",
      validate: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return "Commit SHA is required";
        if (!/^[0-9a-f]{40}$/i.test(trimmed))
          return "Commit must be a 40-character hexadecimal SHA";
        return true;
      },
    })
  ).trim();

  const buildContextPath = (
    await input({
      message: "Enter build context path (relative to repo):",
      default: ".",
      validate: (value) => (value.trim() ? true : "Build context path cannot be empty"),
    })
  ).trim();

  const dockerfilePath = (
    await input({
      message: "Enter Dockerfile path (relative to build context):",
      default: "Dockerfile",
      validate: (value) => (value.trim() ? true : "Dockerfile path cannot be empty"),
    })
  ).trim();

  const caddyfileRaw = (
    await input({
      message: "Enter Caddyfile path (relative to build context, optional):",
      default: "",
      validate: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return true;
        if (trimmed.includes("..")) return "Caddyfile path must not contain '..'";
        return true;
      },
    })
  ).trim();

  const depsRaw = (
    await input({
      message: "Enter dependency digests (comma-separated sha256:..., optional):",
      default: "",
      validate: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return true;
        const parts = trimmed
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean);
        for (const p of parts) {
          if (!/^sha256:[0-9a-f]{64}$/i.test(p)) {
            return `Invalid dependency digest: ${p} (expected sha256:<64 hex>)`;
          }
        }
        return true;
      },
    })
  ).trim();

  const dependencies =
    depsRaw === ""
      ? []
      : depsRaw
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean);

  return {
    repoUrl,
    gitRef,
    dockerfilePath,
    caddyfilePath: caddyfileRaw === "" ? undefined : caddyfileRaw,
    buildContextPath,
    dependencies,
  };
}

/**
 * Prompt for prebuilt verifiable image reference.
 *
 * Required format: docker.io/eigenlayer/eigencloud-containers:<tag>
 */
export async function promptVerifiablePrebuiltImageRef(): Promise<string> {
  ensureInteractive("--image-ref");
  const ref = await input({
    message: "Enter prebuilt verifiable image ref:",
    default: "docker.io/eigenlayer/eigencloud-containers:",
    validate: (value) => {
      const trimmed = value.trim();
      if (!trimmed) return "Image reference is required";
      if (!/^docker\.io\/eigenlayer\/eigencloud-containers:[^@\s]+$/i.test(trimmed)) {
        return "Image ref must match docker.io/eigenlayer/eigencloud-containers:<tag>";
      }
      return true;
    },
  });
  return ref.trim();
}

// ==================== Image Reference Selection ====================

interface RegistryInfo {
  Type: string;
  Username: string;
  URL: string;
}

/**
 * Extract hostname from a registry URL/string for safe comparison
 * This avoids the security issue of using .includes() which can match
 * substrings anywhere (e.g., "malicious.docker.io.attacker.com")
 */
function extractHostname(registry: string): string {
  // Remove protocol if present
  let hostname = registry.replace(/^https?:\/\//, "");
  // Remove path and trailing slashes
  hostname = hostname.split("/")[0];
  // Remove port if present
  hostname = hostname.split(":")[0];
  return hostname.toLowerCase();
}

/**
 * Check if a registry matches Docker Hub
 */
function isDockerHub(registry: string): boolean {
  const hostname = extractHostname(registry);
  return (
    hostname === "docker.io" ||
    hostname === "index.docker.io" ||
    hostname === "registry-1.docker.io"
  );
}

/**
 * Check if a registry matches GitHub Container Registry
 */
function isGHCR(registry: string): boolean {
  const hostname = extractHostname(registry);
  return hostname === "ghcr.io";
}

/**
 * Check if a registry matches Google Container Registry
 */
function isGCR(registry: string): boolean {
  const hostname = extractHostname(registry);
  return hostname === "gcr.io" || hostname.endsWith(".gcr.io");
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

    const { execSync } = await import("child_process");
    const helper = `docker-credential-${credsStore}`;

    try {
      const registryVariants: string[] = [];

      if (isDockerHub(registry)) {
        registryVariants.push("https://index.docker.io/v1/");
        registryVariants.push("https://index.docker.io/v1");
        registryVariants.push("index.docker.io");
        registryVariants.push("docker.io");
      } else {
        const baseRegistry = registry
          .replace(/^https?:\/\//, "")
          .replace(/\/v1\/?$/, "")
          .replace(/\/$/, "");
        registryVariants.push(`https://${baseRegistry}`);
        registryVariants.push(`https://${baseRegistry}/v1/`);
        registryVariants.push(baseRegistry);
      }

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
          continue;
        }
      }
    } catch {
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

    const auths = config.auths || {};
    const credsStore = config.credsStore;
    const gcrProjects = new Map<string, RegistryInfo>();
    const dockerhubUsers = new Map<string, RegistryInfo>();
    const registries: RegistryInfo[] = [];

    for (const [registry, auth] of Object.entries(auths)) {
      const authData = auth as { username?: string; auth?: string };

      // Skip token entries (these are not actual registries)
      const hostname = extractHostname(registry);
      if (hostname.includes("access-token") || hostname.includes("refresh-token")) {
        continue;
      }

      let username = authData.username;
      let registryType = "other";
      let normalizedURL = registry;

      if (isDockerHub(registry)) {
        registryType = "dockerhub";
        normalizedURL = "https://index.docker.io/v1/";
      } else if (isGHCR(registry)) {
        registryType = "ghcr";
        normalizedURL = registry.replace(/^https?:\/\//, "").replace(/\/v1\/?$/, "");
      } else if (isGCR(registry)) {
        registryType = "gcr";
        normalizedURL = "gcr.io";
      }

      if (!username && credsStore) {
        const creds = await getCredentialsFromHelper(registry);
        if (creds) {
          username = creds.username;
        }
      }

      if (!username) {
        continue;
      }

      const info: RegistryInfo = {
        URL: normalizedURL,
        Username: username,
        Type: registryType,
      };

      if (registryType === "gcr") {
        if (!gcrProjects.has(username)) {
          gcrProjects.set(username, info);
        }
        continue;
      }

      // Dedup dockerhub entries (Docker Desktop creates multiple auth entries for the same account)
      if (registryType === "dockerhub") {
        if (!dockerhubUsers.has(username)) {
          dockerhubUsers.set(username, info);
        }
        continue;
      }

      registries.push(info);
    }

    for (const dhInfo of Array.from(dockerhubUsers.values())) {
      registries.push(dhInfo);
    }

    for (const gcrInfo of Array.from(gcrProjects.values())) {
      registries.push(gcrInfo);
    }

    registries.sort((a, b) => {
      if (a.Type === "dockerhub") return -1;
      if (b.Type === "dockerhub") return 1;
      return a.Type.localeCompare(b.Type);
    });

    return registries;
  } catch {
    return [];
  }
}

function getDefaultAppName(): string {
  try {
    // Use INIT_CWD if available (set by npm/pnpm to original cwd)
    const cwd = process.env.INIT_CWD || process.cwd();
    return path.basename(cwd);
  } catch {
    return "myapp";
  }
}

function getCurrentProjectPath(): string {
  return process.env.INIT_CWD || process.cwd();
}

function suggestImageReference(registry: RegistryInfo, imageName: string, tag: string): string {
  imageName = imageName.toLowerCase().replace(/_/g, "-");
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

function displayDetectedRegistries(registries: RegistryInfo[], appName: string): void {
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
    const defaultRef = suggestImageReference(registries[0], imageName, tag);
    return input({
      message: "Enter image reference:",
      default: defaultRef,
      validate: (value) => {
        const result = validateImageReference(value);
        return result === true ? true : result;
      },
    });
  }

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
      validate: (value) => {
        const result = validateImageReference(value);
        return result === true ? true : result;
      },
    });
  }

  return choice;
}

/**
 * Prompt for image reference
 */
export async function getImageReferenceInteractive(
  imageRef?: string,
  buildFromDockerfile: boolean = false,
): Promise<string> {
  if (imageRef) {
    return imageRef;
  }

  ensureInteractive("--image-ref");

  const registries = await getAvailableRegistries();
  const appName = getDefaultAppName();

  if (buildFromDockerfile) {
    console.log("\n📦 Build & Push Configuration");
    console.log("Your Docker image will be built and pushed to a registry");
    console.log("so that Ecloud CLI can pull and run it in the TEE.");
    console.log();

    if (registries.length > 0) {
      displayDetectedRegistries(registries, appName);
      return selectRegistryInteractive(registries, appName, "latest");
    }

    displayAuthenticationInstructions();
  } else {
    console.log("\n🐳 Docker Image Selection");
    console.log("Specify an existing Docker image from a registry to run in the TEE.");
    console.log();
  }

  displayRegistryExamples(appName);

  const imageRefInput = await input({
    message: "Enter Docker image reference:",
    default: "",
    validate: (value) => {
      const result = validateImageReference(value);
      return result === true ? true : result;
    },
  });

  return imageRefInput;
}

// ==================== App Name Selection ====================

/**
 * Get available app name interactively
 */
async function getAvailableAppNameInteractive(
  environment: string,
  imageRef: string,
  suggestedBaseName?: string,
  skipDefaultName?: boolean,
): Promise<string> {
  ensureInteractive("--name");
  const baseName = skipDefaultName
    ? undefined
    : suggestedBaseName || extractAppNameFromImage(imageRef);
  const suggestedName = baseName ? findAvailableName(environment, baseName) : undefined;

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

    if (isAppNameAvailable(environment, name)) {
      return name;
    }

    console.log(`App name '${name}' is already taken.`);
    const newSuggested = findAvailableName(environment, name);
    console.log(`Suggested alternative: ${newSuggested}`);
  }
}

/**
 * Prompt for app name
 */
export async function getOrPromptAppName(
  appName: string | undefined,
  environment: string,
  imageRef: string,
  suggestedBaseName?: string,
  skipDefaultName?: boolean,
): Promise<string> {
  if (appName) {
    validateAppName(appName);
    if (isAppNameAvailable(environment, appName)) {
      return appName;
    }
    console.log(`Warning: App name '${appName}' is already taken.`);
    return getAvailableAppNameInteractive(
      environment,
      imageRef,
      suggestedBaseName,
      skipDefaultName,
    );
  }

  return getAvailableAppNameInteractive(environment, imageRef, suggestedBaseName, skipDefaultName);
}

// ==================== Build ID Selection ====================

function formatBuildChoice(build: Build): string {
  const repoUrl = String(build.repoUrl || "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  const repoName = (() => {
    try {
      const url = new URL(repoUrl);
      const parts = url.pathname.split("/").filter(Boolean);
      return parts.length ? parts[parts.length - 1] : repoUrl;
    } catch {
      const m = repoUrl.match(/[:/]+([^/:]+)$/);
      return m?.[1] || repoUrl || "unknown";
    }
  })();

  const shortSha = build.gitRef ? String(build.gitRef).slice(0, 10) : "unknown";
  const shortId = build.buildId ? String(build.buildId).slice(0, 8) : "unknown";
  const created = build.createdAt ? new Date(build.createdAt).toLocaleString() : "";
  const status = String(build.status || "unknown");
  return `${status}  ${repoName}@${shortSha}  ${shortId}  ${created}`;
}

export async function promptBuildIdFromRecentBuilds(options: {
  client: BuildModule;
  billingAddress: string;
  limit?: number;
}): Promise<string> {
  const limit = Math.max(1, Math.min(100, options.limit ?? 20));
  const builds = await options.client.list({
    billingAddress: options.billingAddress,
    limit,
    offset: 0,
  });

  if (!builds || builds.length === 0) {
    throw new Error(`No builds found for billing address ${options.billingAddress}`);
  }

  const choice = await select({
    message: "Select a build:",
    choices: builds.map((b) => ({
      name: formatBuildChoice(b),
      value: b.buildId,
    })),
  });

  return choice;
}

// ==================== Environment File Selection ====================

/**
 * Resolve the env file path: explicit flag, else auto-detected ./.env.
 * When nonInteractive, defaults to no env file instead of prompting.
 */
export async function getEnvFile(
  envFilePath?: string,
  nonInteractive: boolean = false,
): Promise<string> {
  if (envFilePath && fs.existsSync(envFilePath)) {
    return envFilePath;
  }

  if (fs.existsSync(".env")) {
    return ".env";
  }

  // In non-interactive mode, default to no env file (the same outcome as the
  // interactive "Continue without env file" choice).
  if (nonInteractive) {
    warnDefaulted("--env-file", "no env file");
    return "";
  }

  ensureInteractive("--env-file");
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
        validate: (value) => {
          const result = validateFilePath(value);
          return result === true ? true : result;
        },
      });
      return envFile;
    case "continue":
      return "";
    default:
      throw new Error(`Unexpected choice: ${choice}`);
  }
}

// ==================== Instance Type Selection ====================

/**
 * Smallest TEE tier that runs a real workload (2 vCPU / 8 GB / AMD SEV-SNP);
 * used as the non-interactive deploy default. Confirmed present in the live
 * getSKUs list on mainnet-alpha and sepolia-prod.
 */
export const DEFAULT_NONINTERACTIVE_SKU = "g1-standard-2s";

/**
 * Prompt for instance type
 */
export interface SkuInfo {
  sku: string;
  friendly_name: string;
  description: string;
  vcpus?: number;
  memory_mb?: number;
  monthly_price_usd?: number;
  hourly_price_usd?: number;
  platform?: string;
}

function formatSkuChoice(it: SkuInfo): string {
  // Rich format when pricing data is available
  if (
    it.vcpus != null &&
    it.memory_mb != null &&
    it.monthly_price_usd != null &&
    it.hourly_price_usd != null
  ) {
    const tier = it.friendly_name ?? it.sku;
    const isShared = it.description.toLowerCase().includes("shared");
    const vcpuLabel = isShared ? `Shared ${it.vcpus} vCPU` : `${it.vcpus} vCPU`;
    const memLabel = it.memory_mb >= 1024 ? `${it.memory_mb / 1024} GB` : `${it.memory_mb} MB`;
    const specs = `${vcpuLabel} + ${memLabel}`;
    const pricing = `$${it.hourly_price_usd.toFixed(2)}/hr ($${it.monthly_price_usd.toFixed(2)}/mo)`;

    const platform = it.platform ?? "";
    const tierPad = tier.padEnd(14);
    const specsPad = specs.padEnd(22);
    const platformPad = platform.padEnd(20);
    return `${tierPad} ${specsPad} ${platformPad} ${pricing}`.trimEnd();
  }

  // Fallback: description only
  return `${it.sku} - ${it.description}`;
}

export async function getInstanceType(
  instanceType: string | undefined,
  defaultSKU: string,
  availableTypes: SkuInfo[],
  nonInteractive: boolean = false,
): Promise<string> {
  if (instanceType) {
    // Validate provided instance type
    const valid = availableTypes.find((t) => t.sku === instanceType);
    if (valid) {
      return instanceType;
    }
    const validSKUs = availableTypes.map((t) => t.sku).join(", ");
    throw new Error(`Invalid instance-type: ${instanceType} (must be one of: ${validSKUs})`);
  }

  // Non-interactive: pick a default instead of prompting.
  // Callers pass isNonInteractive(flags) (flag + CI + isTTY) as this argument.
  if (nonInteractive) {
    // Upgrade path: reuse the currently pinned type when one is known.
    if (defaultSKU) {
      warnDefaulted("--instance-type", `current type '${defaultSKU}'`);
      return defaultSKU;
    }
    // Deploy path: smallest TEE tier, if the backend offers it.
    if (availableTypes.some((t) => t.sku === DEFAULT_NONINTERACTIVE_SKU)) {
      warnDefaulted("--instance-type", `'${DEFAULT_NONINTERACTIVE_SKU}'`);
      return DEFAULT_NONINTERACTIVE_SKU;
    }
    const validSKUs = availableTypes.map((t) => t.sku).join(", ");
    throw new Error(
      `Cannot pick a default --instance-type in non-interactive mode: '${DEFAULT_NONINTERACTIVE_SKU}' not offered (available: ${validSKUs}). Provide --instance-type.`,
    );
  }

  ensureInteractive("--instance-type");

  const isCurrentType = defaultSKU !== "";

  // Show pricing header and platform descriptions
  const hasPricing = availableTypes.some((t) => t.monthly_price_usd != null);
  if (hasPricing) {
    console.log("\nPay for what you use \u2014 no upfront costs, per-hour billing.\n");
    console.log(`  ${chalk.bold("Shielded VM (vTPM)")}: Verified boot and runtime attestation.`);
    console.log(
      `  ${chalk.bold("SEV-SNP (TEE)")}: Verified boot, runtime attestation, and hardware-encrypted memory (AMD).`,
    );
    console.log(
      `  ${chalk.bold("TDX (TEE)")}: Verified boot, runtime attestation, and hardware-encrypted memory (Intel).\n`,
    );
  }

  if (isCurrentType && defaultSKU) {
    console.log(`Current instance type: ${defaultSKU}\n`);
  }

  const choices = availableTypes.map((it) => {
    let name = formatSkuChoice(it);
    if (isCurrentType && it.sku === defaultSKU) {
      name += " (current)";
    }
    return { name, value: it.sku };
  });

  const choice = await select({
    message: "Choose instance:",
    choices,
  });

  return choice;
}

// ==================== Log Visibility Selection ====================

export type LogVisibility = "public" | "private" | "off";

/**
 * Resolve log settings from the --log-visibility value.
 * When nonInteractive, defaults to private instead of prompting.
 */
export async function getLogSettings(
  logVisibility?: LogVisibility,
  nonInteractive: boolean = false,
): Promise<{ logRedirect: string; publicLogs: boolean }> {
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
          `Invalid log-visibility: ${logVisibility} (must be public, private, or off)`,
        );
    }
  }

  // In non-interactive mode, default to private logs. Never silently default
  // to public — private is the conservative choice for an unattended deploy.
  if (nonInteractive) {
    warnDefaulted("--log-visibility", "'private'");
    return { logRedirect: "always", publicLogs: false };
  }

  ensureInteractive("--log-visibility");

  const choice = await select({
    message: "Do you want to view your app's logs?",
    choices: [
      { name: "Yes, but only viewable by app and platform admins", value: "private" },
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

// ==================== App ID Selection ====================

// Contract app status constants
export const ContractAppStatusStarted = 1;
export const ContractAppStatusStopped = 2;
export const ContractAppStatusTerminated = 3;
export const ContractAppStatusSuspended = 4;

export function getContractStatusString(status: number): string {
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

function getStatusPriority(status: number, isExited: boolean): number {
  if (isExited) {
    return 1;
  }
  switch (status) {
    case ContractAppStatusStarted:
      return 0;
    case ContractAppStatusStopped:
      return 2;
    case ContractAppStatusTerminated:
      return 3;
    default:
      return 4;
  }
}

/**
 * Get sort priority for status string (lower = higher priority, shown first)
 * Used for sorting apps in list and selection displays
 */
export function getStatusSortPriority(status: string): number {
  switch (status.toLowerCase()) {
    case "running":
    case "started":
      return 0; // Running apps first
    case "deploying":
    case "upgrading":
    case "resuming":
      return 1; // In-progress operations second
    case "stopped":
    case "stopping":
      return 2; // Stopped third
    case "suspended":
      return 3; // Suspended fourth
    case "failed":
      return 4; // Failed fifth
    case "terminated":
      return 5; // Terminated last
    default:
      return 6;
  }
}

function formatAppDisplay(environmentName: string, appID: Address, profileName: string): string {
  if (profileName) {
    return `${profileName} (${environmentName}:${appID})`;
  }
  return `${environmentName}:${appID}`;
}

export interface GetAppIDOptions {
  appID?: string | Address;
  environment: string;
  privateKey?: string;
  rpcUrl?: string;
  action?: string;
}

/**
 * Prompt for app ID (supports app name or address)
 */
export async function getOrPromptAppID(
  appIDOrOptions: string | Address | GetAppIDOptions | undefined,
  environment?: string,
): Promise<Address> {
  let options: GetAppIDOptions;
  if (environment !== undefined) {
    options = {
      appID: appIDOrOptions as string | Address | undefined,
      environment: environment,
    };
  } else if (
    appIDOrOptions &&
    typeof appIDOrOptions === "object" &&
    "environment" in appIDOrOptions
  ) {
    options = appIDOrOptions as GetAppIDOptions;
  } else {
    options = {
      appID: appIDOrOptions as string | Address | undefined,
      environment: "sepolia",
    };
  }

  if (options.appID) {
    const normalized =
      typeof options.appID === "string" ? addHexPrefix(options.appID) : options.appID;

    if (isAddress(normalized)) {
      return normalized as Address;
    }

    // Check profile cache first (remote profile names)
    const profileCache = getProfileCache(options.environment);
    if (profileCache) {
      const searchName = (options.appID as string).toLowerCase();
      for (const [appId, name] of Object.entries(profileCache)) {
        if (name.toLowerCase() === searchName) {
          return appId as Address;
        }
      }
    }

    // Fall back to local registry
    const apps = listApps(options.environment);
    const foundAppID = apps[options.appID as string];
    if (foundAppID) {
      return addHexPrefix(foundAppID) as Address;
    }

    throw new Error(
      `App name '${options.appID}' not found in environment '${options.environment}'. ` +
        `Name lookup uses a local cache that may be stale. ` +
        `Try using the app ID (0x...) directly, or run 'ecloud compute app list' to refresh the cache.`,
    );
  }

  ensureInteractive("app-id argument");
  return getAppIDInteractive(options);
}

async function getAppIDInteractive(options: GetAppIDOptions): Promise<Address> {
  const action = options.action || "view";
  const environment = options.environment || "sepolia";
  const environmentConfig = getEnvironmentConfig(environment);

  if (!options.privateKey || !options.rpcUrl) {
    return getAppIDInteractiveFromRegistry(environment, action);
  }

  console.log(`\nSelect an app to ${action}:\n`);

  const privateKeyHex = addHexPrefix(options.privateKey);
  const account = privateKeyToAccount(privateKeyHex);
  const developerAddr = account.address;

  // Create viem clients for API calls
  const { publicClient, walletClient } = createViemClients({
    privateKey: options.privateKey!,
    rpcUrl: options.rpcUrl!,
    environment,
  });

  const { apps, appConfigs } = await getAllAppsByDeveloper(
    publicClient,
    environmentConfig,
    developerAddr,
  );

  if (apps.length === 0) {
    throw new Error("no apps found for your address");
  }

  // Build profile names from cache, API, and local registry
  const profileNames: Record<string, string> = {};

  // Load from profile cache first (remote profiles take priority)
  let cachedProfiles = getProfileCache(environment);

  // If cache is empty/expired, fetch fresh profile names from API
  if (!cachedProfiles) {
    try {
      const userApiClient = new UserApiClient(environmentConfig, walletClient, publicClient, {
        clientId: getClientId(),
      });
      const appInfos = await getAppInfosChunked(userApiClient, apps);

      // Build and cache profile names
      const freshProfiles: Record<string, string> = {};
      for (const info of appInfos) {
        if (info.profile?.name) {
          const normalizedId = String(info.address).toLowerCase();
          freshProfiles[normalizedId] = info.profile.name;
        }
      }

      // Save to cache for future use
      setProfileCache(environment, freshProfiles);
      cachedProfiles = freshProfiles;
    } catch {
      // On error, continue without profile names
      cachedProfiles = {};
    }
  }

  // Add cached profiles to profileNames
  for (const [appId, name] of Object.entries(cachedProfiles)) {
    profileNames[appId.toLowerCase()] = name;
  }

  // Also include local registry names (for apps without remote profiles)
  const localApps = listApps(environment);
  for (const [name, appID] of Object.entries(localApps)) {
    const normalizedID = String(appID).toLowerCase();
    if (!profileNames[normalizedID]) {
      profileNames[normalizedID] = name;
    }
  }

  const isEligible = (status: number): boolean => {
    switch (action) {
      case "view":
      case "view info for":
      case "view releases for":
      case "set profile for":
        return true;
      case "start":
        return status === ContractAppStatusStopped || status === ContractAppStatusSuspended;
      case "stop":
        return status === ContractAppStatusStarted;
      default:
        return status !== ContractAppStatusTerminated && status !== ContractAppStatusSuspended;
    }
  };

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

    const statusStr = getContractStatusString(status);
    const profileName = profileNames[String(appAddr).toLowerCase()] || "";
    const displayName = formatAppDisplay(environmentConfig.name, appAddr, profileName);

    appItems.push({
      addr: appAddr,
      display: `${displayName} - ${statusStr}`,
      status,
      index: i,
    });
  }

  const linkedAppId = getLinkedAppForDirectory(environment, getCurrentProjectPath());
  const normalizedLinkedAppId = linkedAppId ? linkedAppId.toLowerCase() : "";

  appItems.sort((a, b) => {
    if (normalizedLinkedAppId) {
      const aLinked = String(a.addr).toLowerCase() === normalizedLinkedAppId;
      const bLinked = String(b.addr).toLowerCase() === normalizedLinkedAppId;
      if (aLinked && !bLinked) {
        return -1;
      }
      if (bLinked && !aLinked) {
        return 1;
      }
    }

    const aPriority = getStatusPriority(a.status, false);
    const bPriority = getStatusPriority(b.status, false);

    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    return b.index - a.index;
  });

  if (appItems.length === 0) {
    switch (action) {
      case "start":
        throw new Error("no startable apps found - only Stopped apps can be started");
      case "stop":
        throw new Error("no running apps found - only Running apps can be stopped");
      default:
        throw new Error("no active apps found");
    }
  }

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

async function getAppIDInteractiveFromRegistry(
  environment: string,
  action: string,
): Promise<Address> {
  // Build combined app list from profile cache and local registry
  const allApps: Record<string, string> = {}; // name -> appId

  // Add from profile cache (remote profiles)
  const cachedProfiles = getProfileCache(environment);
  if (cachedProfiles) {
    for (const [appId, name] of Object.entries(cachedProfiles)) {
      allApps[name] = appId;
    }
  }

  // Add from local registry (may override or add new entries)
  const localApps = listApps(environment);
  for (const [name, appId] of Object.entries(localApps)) {
    if (!allApps[name]) {
      allApps[name] = appId;
    }
  }

  if (Object.keys(allApps).length === 0) {
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
        const normalized = addHexPrefix(value);
        if (isAddress(normalized)) {
          return true;
        }
        return "Invalid app ID address";
      },
    });

    const normalized = addHexPrefix(appIDInput);
    if (isAddress(normalized)) {
      return normalized as Address;
    }
    throw new Error(`Invalid app ID address: ${appIDInput}`);
  }

  const entries = Object.entries(allApps);
  const linkedAppId = getLinkedAppForDirectory(environment, getCurrentProjectPath());
  if (linkedAppId) {
    const linkedIndex = entries.findIndex(
      ([, appId]) => String(appId).toLowerCase() === linkedAppId.toLowerCase(),
    );
    if (linkedIndex > 0) {
      const [linkedEntry] = entries.splice(linkedIndex, 1);
      entries.unshift(linkedEntry);
    }
  }

  const choices = entries.map(([name, appID]) => {
    const displayName = `${name} (${appID})`;
    return { name: displayName, value: appID };
  });

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
        if (allApps[value]) {
          return true;
        }
        return "Invalid app ID or name not found";
      },
    });

    const normalized = addHexPrefix(appIDInput);
    if (isAddress(normalized)) {
      return normalized as Address;
    }
    const foundAppID = allApps[appIDInput];
    if (foundAppID) {
      return addHexPrefix(foundAppID) as Address;
    }
    throw new Error(`Failed to resolve app ID from input: ${appIDInput}`);
  }

  return addHexPrefix(selected) as Address;
}

// ==================== Resource Usage Monitoring Selection ====================

export type ResourceUsageMonitoring = "enable" | "disable";

/**
 * Resolve the resource-usage-monitoring setting from the flag value.
 * When nonInteractive, defaults to disable instead of prompting.
 */
export async function getResourceUsageMonitoring(
  resourceUsageMonitoring?: ResourceUsageMonitoring,
  nonInteractive: boolean = false,
): Promise<ResourceUsageMonitoring> {
  if (resourceUsageMonitoring) {
    switch (resourceUsageMonitoring) {
      case "enable":
      case "disable":
        return resourceUsageMonitoring;
      default:
        throw new Error(
          `Invalid resource-usage-monitoring: ${resourceUsageMonitoring} (must be enable or disable)`,
        );
    }
  }

  // In non-interactive mode, default to disabled resource usage monitoring.
  if (nonInteractive) {
    warnDefaulted("--resource-usage-monitoring", "'disable'");
    return "disable";
  }

  ensureInteractive("--resource-usage-monitoring");

  const choice = await select({
    message: "Show resource usage (CPU/memory) for your app?",
    choices: [
      { name: "Yes, enable resource usage monitoring", value: "enable" },
      { name: "No, disable resource usage monitoring", value: "disable" },
    ],
  });

  return choice as ResourceUsageMonitoring;
}

// ==================== Confirmation ====================

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
  if (!process.stdin.isTTY) {
    return defaultValue;
  }
  return await inquirerConfirm({
    message: prompt,
    default: defaultValue,
  });
}

// ==================== Private Key ====================

/**
 * Get private key - first tries keyring, then prompts interactively
 */
export async function getPrivateKeyInteractive(privateKey?: string): Promise<string> {
  // If provided directly, validate and return
  if (privateKey) {
    if (!validatePrivateKeyFormat(privateKey)) {
      throw new Error("Invalid private key format");
    }
    return privateKey;
  }

  // Try to get from keyring using SDK's resolver
  const { getPrivateKeyWithSource } = await import("@layr-labs/ecloud-sdk");
  const result = await getPrivateKeyWithSource({ privateKey: undefined });

  if (result) {
    return result.key;
  }

  // No key in keyring, prompt user
  ensureInteractive("--private-key or ECLOUD_PRIVATE_KEY");
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

// ==================== Environment Selection ====================

/**
 * Prompt for environment selection
 */
export async function getEnvironmentInteractive(environment?: string): Promise<string> {
  if (environment) {
    // Validate the explicit value and surface the real error to the user.
    // getEnvironmentConfig throws a descriptive error for unknown environments
    // AND for environments not available in the current build (dev vs prod).
    // Previously we caught this silently and fell through to the interactive
    // prompt, which in non-TTY mode surfaced the generic "Cannot prompt in
    // non-interactive mode" error — hiding the real reason (e.g. "mainnet-alpha
    // is not available in this build type" when using a dev build).
    getEnvironmentConfig(environment);
    return environment;
  }

  ensureInteractive("--environment or ECLOUD_ENV");

  const availableEnvs = getAvailableEnvironments();

  let defaultEnv: string | undefined;
  const configDefaultEnv = getDefaultEnvironment();
  if (configDefaultEnv && availableEnvs.includes(configDefaultEnv)) {
    try {
      getEnvironmentConfig(configDefaultEnv);
      defaultEnv = configDefaultEnv;
    } catch {
      // Default env is invalid, ignore it
    }
  }

  const choices = [];
  if (availableEnvs.includes("sepolia")) {
    choices.push({ name: "sepolia - Ethereum Sepolia testnet", value: "sepolia" });
  }
  if (availableEnvs.includes("sepolia-dev")) {
    choices.push({ name: "sepolia-dev - Ethereum Sepolia testnet (dev)", value: "sepolia-dev" });
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
    default: defaultEnv,
  });

  return env;
}

// ==================== Template Selection ====================

/**
 * Prompt for project name
 */
export async function promptProjectName(): Promise<string> {
  return input({ message: "Enter project name:" });
}

/**
 * Prompt for language selection
 */
export async function promptLanguage(): Promise<string> {
  return select({
    message: "Select language:",
    choices: PRIMARY_LANGUAGES,
  });
}

/**
 * Select template interactively
 */
export async function selectTemplateInteractive(language: string): Promise<string> {
  const catalog = await fetchTemplateCatalog();
  const categoryDescriptions = getCategoryDescriptions(catalog, language);

  if (Object.keys(categoryDescriptions).length === 0) {
    throw new Error(`No templates found for language ${language}`);
  }

  const categories = Object.keys(categoryDescriptions).sort();

  const options = categories.map((category) => {
    const description = categoryDescriptions[category];
    if (description) {
      return { name: `${category}: ${description}`, value: category };
    }
    return { name: category, value: category };
  });

  const selected = await select({
    message: "Select template:",
    choices: options,
  });

  return selected;
}

// ==================== App Profile ====================

const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4MB
const VALID_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png"];
const VALID_X_HOSTS = ["twitter.com", "www.twitter.com", "x.com", "www.x.com"];

export function validateURL(rawURL: string): string | undefined {
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

export function validateXURL(rawURL: string): string | undefined {
  const urlErr = validateURL(rawURL);
  if (urlErr) {
    return urlErr;
  }

  try {
    const url = new URL(rawURL);
    const host = url.hostname.toLowerCase();

    if (!VALID_X_HOSTS.includes(host)) {
      return "URL must be a valid X/Twitter URL (x.com or twitter.com)";
    }

    if (!url.pathname || url.pathname === "/") {
      return "X URL must include a username or profile path";
    }
  } catch {
    return "Invalid X URL format";
  }

  return undefined;
}

export function validateDescription(description: string): string | undefined {
  if (!description.trim()) {
    return "Description cannot be empty";
  }

  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return `Description cannot exceed ${MAX_DESCRIPTION_LENGTH} characters`;
  }

  return undefined;
}

export function validateImagePath(filePath: string): string | undefined {
  const cleanedPath = filePath.trim().replace(/^["']|["']$/g, "");

  if (!cleanedPath) {
    return "Image path cannot be empty";
  }

  if (!fs.existsSync(cleanedPath)) {
    return `Image file not found: ${cleanedPath}`;
  }

  const stats = fs.statSync(cleanedPath);
  if (stats.isDirectory()) {
    return "Path is a directory, not a file";
  }

  if (stats.size > MAX_IMAGE_SIZE) {
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    return `Image file size (${sizeMB} MB) exceeds maximum allowed size of 4 MB`;
  }

  const ext = path.extname(cleanedPath).toLowerCase();
  if (!VALID_IMAGE_EXTENSIONS.includes(ext)) {
    return "Image must be JPG or PNG format";
  }

  return undefined;
}

/**
 * Validate an app profile object
 * Returns an error message if validation fails, undefined if valid
 */
export function validateAppProfile(profile: {
  name: string;
  website?: string;
  description?: string;
  xURL?: string;
  imagePath?: string;
}): string | undefined {
  // Name is required
  if (!profile.name || !profile.name.trim()) {
    return "Profile name is required";
  }

  try {
    validateAppName(profile.name);
  } catch (err: any) {
    return `Invalid profile name: ${err.message}`;
  }

  // Validate optional fields if provided
  if (profile.website) {
    const websiteErr = validateURL(profile.website);
    if (websiteErr) {
      return `Invalid website: ${websiteErr}`;
    }
  }

  if (profile.description) {
    const descErr = validateDescription(profile.description);
    if (descErr) {
      return `Invalid description: ${descErr}`;
    }
  }

  if (profile.xURL) {
    const xURLErr = validateXURL(profile.xURL);
    if (xURLErr) {
      return `Invalid X URL: ${xURLErr}`;
    }
  }

  if (profile.imagePath) {
    const imageErr = validateImagePath(profile.imagePath);
    if (imageErr) {
      return `Invalid image: ${imageErr}`;
    }
  }

  return undefined;
}

/**
 * Collect app profile information interactively
 */
export async function getAppProfileInteractive(
  defaultName: string = "",
  allowRetry: boolean = true,
): Promise<AppProfile | undefined> {
  ensureInteractive("--skip-profile or --website/--description/--x-url/--image");
  while (true) {
    const name = await getAppNameForProfile(defaultName);
    const website = await getAppWebsiteInteractive();
    const description = await getAppDescriptionInteractive();
    const xURL = await getAppXURLInteractive();
    const imagePath = await getAppImageInteractive();
    const { image, imageName } = imagePathToBlob(imagePath);

    const profile: AppProfile = {
      name,
      website,
      description,
      xURL,
      image,
      imageName,
    };

    console.log("\n" + formatProfileForDisplay(profile));

    const confirmed = await inquirerConfirm({
      message: "Continue with this profile?",
      default: true,
    });

    if (confirmed) {
      return profile;
    }

    if (!allowRetry) {
      throw new Error("Profile confirmation cancelled");
    }

    const retry = await inquirerConfirm({
      message: "Would you like to re-enter the information?",
      default: true,
    });

    if (!retry) {
      return undefined;
    }

    defaultName = name;
  }
}

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

async function getAppWebsiteInteractive(): Promise<string | undefined> {
  const website = await input({
    message: "Website URL (optional):",
    default: "",
    validate: (value: string) => {
      if (!value.trim()) {
        return true;
      }
      const err = validateURL(value);
      return err ? err : true;
    },
  });

  if (!website.trim()) {
    return undefined;
  }

  return website;
}

async function getAppDescriptionInteractive(): Promise<string | undefined> {
  const description = await input({
    message: "Description (optional):",
    default: "",
    validate: (value: string) => {
      if (!value.trim()) {
        return true;
      }
      const err = validateDescription(value);
      return err ? err : true;
    },
  });

  if (!description.trim()) {
    return undefined;
  }

  return description;
}

async function getAppXURLInteractive(): Promise<string | undefined> {
  const xURL = await input({
    message: "X (Twitter) URL (optional):",
    default: "",
    validate: (value: string) => {
      if (!value.trim()) {
        return true;
      }
      const err = validateXURL(value);
      return err ? err : true;
    },
  });

  if (!xURL.trim()) {
    return undefined;
  }

  return xURL;
}

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
        return true;
      }
      const err = validateImagePath(value);
      return err ? err : true;
    },
  });

  if (!imagePath.trim()) {
    return undefined;
  }

  return imagePath.trim().replace(/^["']|["']$/g, "");
}

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
  if (profile.imageName) {
    output += `  Image:       ${profile.imageName}\n`;
  }
  return output;
}

export function imagePathToBlob(imagePath?: string): {
  image: Blob | undefined;
  imageName: string | undefined;
} {
  if (!imagePath) {
    return { image: undefined, imageName: undefined };
  }
  try {
    const fileBuffer = fs.readFileSync(imagePath);
    const imageName = path.basename(imagePath);
    return { image: new Blob([fileBuffer]), imageName };
  } catch (err) {
    console.error(`Failed to read image file: ${err}`);
    return { image: undefined, imageName: undefined };
  }
}
