/**
 * Environment file parsing and validation
 */

import * as fs from "fs";
import { ParsedEnvironment } from "../types";

const MNEMONIC_ENV_VAR = "MNEMONIC";

/**
 * Parse environment file and split into public/private variables
 */
export function parseAndValidateEnvFile(envFilePath: string): ParsedEnvironment {
  if (!fs.existsSync(envFilePath)) {
    throw new Error(`Environment file not found: ${envFilePath}`);
  }

  const content = fs.readFileSync(envFilePath, "utf-8");
  const env: Record<string, string> = {};
  let mnemonicFiltered = false;

  // Parse .env file (simple parser - can be enhanced)
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalIndex = trimmed.indexOf("=");
    if (equalIndex === -1) {
      continue;
    }

    const key = trimmed.substring(0, equalIndex).trim();
    let value = trimmed.substring(equalIndex + 1).trim();

    // Remove quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Filter out mnemonic
    if (key.toUpperCase() === MNEMONIC_ENV_VAR) {
      mnemonicFiltered = true;
      continue;
    }

    env[key] = value;
  }

  // Split into public and private
  const publicEnv: Record<string, string> = {};
  const privateEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (key.endsWith("_PUBLIC")) {
      publicEnv[key] = value;
    } else {
      privateEnv[key] = value;
    }
  }

  return {
    public: publicEnv,
    private: privateEnv,
    // Include mnemonicFiltered flag for logging
    _mnemonicFiltered: mnemonicFiltered,
  } as ParsedEnvironment & { _mnemonicFiltered?: boolean };
}

/**
 * Display environment variables for user confirmation
 */
export function displayEnvironmentVariables(
  parsed: ParsedEnvironment & { _mnemonicFiltered?: boolean },
): void {
  console.log("\nYour container will deploy with the following environment variables:\n");

  if (parsed._mnemonicFiltered) {
    console.log(
      "\x1b[3;36mMnemonic environment variable removed to be overridden by protocol provided mnemonic\x1b[0m\n",
    );
  }

  // Print public variables
  if (Object.keys(parsed.public).length > 0) {
    console.log("PUBLIC VARIABLE\tVALUE");
    console.log("---------------\t-----");
    for (const [key, value] of Object.entries(parsed.public)) {
      console.log(`${key}\t${value}`);
    }
  } else {
    console.log("No public variables found");
  }

  console.log("\n-----------------------------------------\n");

  // Print private variables
  if (Object.keys(parsed.private).length > 0) {
    console.log("PRIVATE VARIABLE\tVALUE");
    console.log("----------------\t-----\n");
    for (const [key, value] of Object.entries(parsed.private)) {
      // Mask private values for display
      const masked =
        value.length > 8
          ? `${value.substring(0, 4)}...${value.substring(value.length - 4)}`
          : "***";
      console.log(`${key}\t${masked}`);
    }
  } else {
    console.log("No private variables found");
  }

  console.log();
}
