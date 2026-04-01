/**
 * Utilities for merging inline --env KEY=VALUE flags with env files
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Parse an inline env var string of the form KEY=VALUE.
 * Throws if the format is invalid.
 */
function parseInlineEnvVar(envVar: string): [string, string] {
  const eqIndex = envVar.indexOf("=");
  if (eqIndex === -1) {
    throw new Error(`Invalid --env format: "${envVar}". Expected KEY=VALUE`);
  }

  const key = envVar.substring(0, eqIndex).trim();
  if (!key) {
    throw new Error(`Invalid --env format: "${envVar}". Key cannot be empty`);
  }

  const value = envVar.substring(eqIndex + 1);
  return [key, value];
}

/**
 * Merge inline env vars with an env file, writing the result to a temp file.
 * Inline vars override env file vars with the same key.
 *
 * Returns the path to the merged temp file, or the original env file path
 * if there are no inline vars to merge.
 */
export function mergeInlineEnvVars(envFilePath: string, inlineEnvVars: string[]): string {
  if (!inlineEnvVars || inlineEnvVars.length === 0) {
    return envFilePath;
  }

  // Parse inline vars first to fail fast on bad format
  const inlineEntries = inlineEnvVars.map(parseInlineEnvVar);

  // Read existing env file content (if any)
  let existingLines: string[] = [];
  if (envFilePath && fs.existsSync(envFilePath)) {
    existingLines = fs.readFileSync(envFilePath, "utf-8").split("\n");
  }

  // Build a set of keys being overridden by inline vars
  const inlineKeys = new Set(inlineEntries.map(([key]) => key));

  // Filter out lines from the env file that are overridden by inline vars
  const filteredLines = existingLines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return true; // keep comments and blank lines
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      return true; // keep malformed lines
    }
    const key = trimmed.substring(0, eqIndex).trim();
    return !inlineKeys.has(key);
  });

  // Append inline vars
  const inlineLines = inlineEntries.map(([key, value]) => `${key}=${value}`);
  const merged = [...filteredLines, ...inlineLines].join("\n");

  // Write to temp file
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ecloud-env-"));
  const tmpFile = path.join(tmpDir, ".env");
  fs.writeFileSync(tmpFile, merged);
  return tmpFile;
}
