/**
 * Non-interactive validation utilities for SDK
 *
 * These functions validate parameters without any interactive prompts.
 * They either return the validated value or throw an error.
 */

import fs from "fs";
import path from "path";
import { Address, isAddress } from "viem";
import { stripHexPrefix, addHexPrefix } from "./helpers";
import { listApps } from "../registry/appNames";

// ==================== App Name Validation ====================

/**
 * Validate app name format
 * @throws Error if name is invalid
 */
export function validateAppName(name: string): void {
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

/**
 * Check if an app name is available in the given environment
 */
export function isAppNameAvailable(environment: string, name: string): boolean {
  const apps = listApps(environment);
  return !apps[name];
}

/**
 * Find an available app name by appending numbers if needed
 */
export function findAvailableName(environment: string, baseName: string): string {
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

// ==================== Image Reference Validation ====================

/**
 * Validate Docker image reference format
 * @returns true if valid, error message string if invalid
 */
export function validateImageReference(value: string): true | string {
  if (!value) {
    return "Image reference cannot be empty";
  }
  // Basic validation - should contain at least one / and optionally :
  if (!value.includes("/")) {
    return "Image reference must contain at least one /";
  }
  return true;
}

/**
 * Validate image reference and throw if invalid
 * @throws Error if image reference is invalid
 */
export function assertValidImageReference(value: string): void {
  const result = validateImageReference(value);
  if (result !== true) {
    throw new Error(result);
  }
}

/**
 * Extract app name from image reference
 */
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

// ==================== File Path Validation ====================

/**
 * Validate that a file path exists
 * @returns true if valid, error message string if invalid
 */
export function validateFilePath(value: string): true | string {
  if (!value) {
    return "File path cannot be empty";
  }
  if (!fs.existsSync(value)) {
    return "File does not exist";
  }
  return true;
}

/**
 * Validate file path and throw if invalid
 * @throws Error if file path is invalid or doesn't exist
 */
export function assertValidFilePath(value: string): void {
  const result = validateFilePath(value);
  if (result !== true) {
    throw new Error(result);
  }
}

// ==================== Instance Type Validation ====================

/**
 * Validate instance type SKU against available types
 * @returns the validated SKU
 * @throws Error if SKU is not in the available types list
 */
export function validateInstanceTypeSKU(
  sku: string,
  availableTypes: Array<{ sku: string }>,
): string {
  if (!sku) {
    throw new Error("Instance type SKU cannot be empty");
  }

  // Check if SKU is valid
  for (const it of availableTypes) {
    if (it.sku === sku) {
      return sku;
    }
  }

  // Build helpful error message with valid options
  const validSKUs = availableTypes.map((it) => it.sku).join(", ");
  throw new Error(`Invalid instance-type value: ${sku} (must be one of: ${validSKUs})`);
}

// ==================== Private Key Validation ====================

/**
 * Validate private key format
 * Matches Go's common.ValidatePrivateKey() function
 */
export function validatePrivateKeyFormat(key: string): boolean {
  // Remove 0x prefix if present
  const keyWithoutPrefix = stripHexPrefix(key);

  // Must be 64 hex characters (32 bytes)
  if (!/^[0-9a-fA-F]{64}$/.test(keyWithoutPrefix)) {
    return false;
  }

  return true;
}

/**
 * Validate private key and throw if invalid
 * @throws Error if private key format is invalid
 */
export function assertValidPrivateKey(key: string): void {
  if (!key) {
    throw new Error("Private key is required");
  }
  if (!validatePrivateKeyFormat(key)) {
    throw new Error(
      "Invalid private key format (must be 64 hex characters, optionally prefixed with 0x)",
    );
  }
}

// ==================== URL Validation ====================

/**
 * Validate URL format
 * @returns undefined if valid, error message string if invalid
 */
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

/**
 * Valid X/Twitter hosts
 */
const VALID_X_HOSTS = ["twitter.com", "www.twitter.com", "x.com", "www.x.com"];

/**
 * Validate X/Twitter URL format
 * @returns undefined if valid, error message string if invalid
 */
export function validateXURL(rawURL: string): string | undefined {
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

// ==================== Description Validation ====================

const MAX_DESCRIPTION_LENGTH = 1000;

/**
 * Validate description length
 * @returns undefined if valid, error message string if invalid
 */
export function validateDescription(description: string): string | undefined {
  if (!description.trim()) {
    return "Description cannot be empty";
  }

  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return `Description cannot exceed ${MAX_DESCRIPTION_LENGTH} characters`;
  }

  return undefined;
}

// ==================== Image Path Validation ====================

const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4MB
const VALID_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png"];

/**
 * Validate image file path
 * @returns undefined if valid, error message string if invalid
 */
export function validateImagePath(filePath: string): string | undefined {
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

// ==================== App ID Resolution ====================

/**
 * Resolve app ID from name or address
 * @param appIDOrName - App ID (address) or app name
 * @param environment - Environment name
 * @returns Resolved app address
 * @throws Error if app ID cannot be resolved
 */
export function resolveAppID(appIDOrName: string | Address, environment: string): Address {
  if (!appIDOrName) {
    throw new Error("App ID or name is required");
  }

  // Normalize the input
  const normalized = typeof appIDOrName === "string" ? addHexPrefix(appIDOrName) : appIDOrName;

  // Check if it's a valid address
  if (isAddress(normalized)) {
    return normalized as Address;
  }

  // If not a valid address, treat as app name and look it up
  const apps = listApps(environment);
  const foundAppID = apps[appIDOrName as string];
  if (foundAppID) {
    // Ensure it has 0x prefix
    return addHexPrefix(foundAppID) as Address;
  }

  // Name not found
  throw new Error(`App name '${appIDOrName}' not found in environment '${environment}'`);
}

// ==================== Log Visibility Validation ====================

export type LogVisibility = "public" | "private" | "off";

/**
 * Validate and convert log visibility setting to internal format
 * @param logVisibility - Log visibility setting
 * @returns Object with logRedirect and publicLogs settings
 * @throws Error if log visibility value is invalid
 */
export function validateLogVisibility(logVisibility: LogVisibility): {
  logRedirect: string;
  publicLogs: boolean;
} {
  switch (logVisibility) {
    case "public":
      return { logRedirect: "always", publicLogs: true };
    case "private":
      return { logRedirect: "always", publicLogs: false };
    case "off":
      return { logRedirect: "", publicLogs: false };
    default:
      throw new Error(
        `Invalid log-visibility value: ${logVisibility} (must be public, private, or off)`,
      );
  }
}

// ==================== Sanitization Functions ====================

/**
 * Check if URL has scheme
 */
function hasScheme(rawURL: string): boolean {
  return rawURL.startsWith("http://") || rawURL.startsWith("https://");
}

/**
 * Sanitize string (HTML escape and trim)
 */
export function sanitizeString(s: string): string {
  return s
    .trim()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Sanitize URL (add https:// if missing, validate)
 * @throws Error if URL is invalid after sanitization
 */
export function sanitizeURL(rawURL: string): string {
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

/**
 * Sanitize X/Twitter URL (handle username-only input, normalize)
 * @throws Error if URL is invalid after sanitization
 */
export function sanitizeXURL(rawURL: string): string {
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

// ==================== Deploy/Upgrade Parameter Validation ====================

export interface DeployParams {
  dockerfilePath?: string;
  imageRef?: string;
  appName: string;
  envFilePath?: string;
  instanceType: string;
  logVisibility: LogVisibility;
}

/**
 * Validate deploy parameters
 * @throws Error if required parameters are missing or invalid
 */
export function validateDeployParams(params: Partial<DeployParams>): void {
  // Must have either dockerfilePath or imageRef
  if (!params.dockerfilePath && !params.imageRef) {
    throw new Error("Either dockerfilePath or imageRef is required for deployment");
  }

  // If imageRef is provided, validate it
  if (params.imageRef) {
    assertValidImageReference(params.imageRef);
  }

  // If dockerfilePath is provided, validate it exists
  if (params.dockerfilePath) {
    assertValidFilePath(params.dockerfilePath);
  }

  // App name is required
  if (!params.appName) {
    throw new Error("App name is required");
  }
  validateAppName(params.appName);

  // Instance type is required
  if (!params.instanceType) {
    throw new Error("Instance type is required");
  }

  // Log visibility is required
  if (!params.logVisibility) {
    throw new Error("Log visibility is required (public, private, or off)");
  }
  validateLogVisibility(params.logVisibility);

  // Env file path is optional, but if provided, validate it exists
  if (params.envFilePath && params.envFilePath !== "") {
    const result = validateFilePath(params.envFilePath);
    if (result !== true) {
      throw new Error(`Invalid env file: ${result}`);
    }
  }
}

export interface UpgradeParams {
  appID: string | Address;
  dockerfilePath?: string;
  imageRef?: string;
  envFilePath?: string;
  instanceType: string;
  logVisibility: LogVisibility;
}

/**
 * Validate upgrade parameters
 * @throws Error if required parameters are missing or invalid
 */
export function validateUpgradeParams(params: Partial<UpgradeParams>, environment: string): void {
  // App ID is required
  if (!params.appID) {
    throw new Error("App ID is required for upgrade");
  }
  // Validate app ID can be resolved (throws if not)
  resolveAppID(params.appID, environment);

  // Must have either dockerfilePath or imageRef
  if (!params.dockerfilePath && !params.imageRef) {
    throw new Error("Either dockerfilePath or imageRef is required for upgrade");
  }

  // If imageRef is provided, validate it
  if (params.imageRef) {
    assertValidImageReference(params.imageRef);
  }

  // If dockerfilePath is provided, validate it exists
  if (params.dockerfilePath) {
    assertValidFilePath(params.dockerfilePath);
  }

  // Instance type is required
  if (!params.instanceType) {
    throw new Error("Instance type is required");
  }

  // Log visibility is required
  if (!params.logVisibility) {
    throw new Error("Log visibility is required (public, private, or off)");
  }
  validateLogVisibility(params.logVisibility);

  // Env file path is optional, but if provided, validate it exists
  if (params.envFilePath && params.envFilePath !== "") {
    const result = validateFilePath(params.envFilePath);
    if (result !== true) {
      throw new Error(`Invalid env file: ${result}`);
    }
  }
}

export interface CreateAppParams {
  name: string;
  language: string;
  template?: string;
  templateVersion?: string;
}

/**
 * Validate create app parameters
 * @throws Error if required parameters are missing or invalid
 */
export function validateCreateAppParams(params: Partial<CreateAppParams>): void {
  if (!params.name) {
    throw new Error("Project name is required");
  }

  // Validate project name (no spaces)
  if (params.name.includes(" ")) {
    throw new Error("Project name cannot contain spaces");
  }

  if (!params.language) {
    throw new Error("Language is required");
  }
}

export interface LogsParams {
  appID: string | Address;
  watch?: boolean;
}

/**
 * Validate logs parameters
 * @throws Error if required parameters are missing or invalid
 */
export function validateLogsParams(params: Partial<LogsParams>, environment: string): void {
  if (!params.appID) {
    throw new Error("App ID is required for viewing logs");
  }
  // Validate app ID can be resolved (throws if not)
  resolveAppID(params.appID, environment);
}
