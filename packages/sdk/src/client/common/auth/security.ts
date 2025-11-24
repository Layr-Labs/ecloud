/**
 * Security Utilities
 *
 * Provides secure display and input handling for sensitive data like private keys
 */

import { password, select } from "@inquirer/prompts";
import { spawn } from "child_process";
import { platform } from "os";

/**
 * Display sensitive content using system pager (less/more)
 * Returns true if content was displayed, false if user aborted
 */
export async function showPrivateKey(content: string): Promise<boolean> {
  // Try to use system pager
  const pager = detectPager();

  if (pager) {
    try {
      await runPager(pager, content);
      return true;
    } catch (err) {
      console.error(`Failed to run pager: ${err}`);
      // Fall through to fallback
    }
  }

  // No pager available - give user a choice
  console.log("\nNo pager (less/more) found on PATH.");
  console.log("For security, avoid printing private keys to the terminal.");
  console.log("");

  const choice = await select({
    message: "Choose an option:",
    choices: [
      { name: "Abort (recommended)", value: "abort" },
      { name: "Print and clear screen", value: "print" },
    ],
  });

  if (choice === "print") {
    console.log(content);
    console.log("");
    console.log("Press Enter after you have securely saved the key.");
    console.log("The screen will be cleared...");

    // Wait for Enter
    await password({
      message: "",
      mask: "",
    });

    clearTerminal();
    return true;
  }

  return false; // User aborted
}

/**
 * Detect system pager (less or more)
 */
function detectPager(): string | null {
  // Check PAGER env var first
  if (process.env.PAGER) {
    return process.env.PAGER;
  }

  // Try common pagers
  const pagers = ["less", "more"];

  for (const pager of pagers) {
    if (commandExists(pager)) {
      return pager;
    }
  }

  return null;
}

/**
 * Run pager with content
 */
function runPager(pager: string, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(pager, [], {
      stdio: ["pipe", "inherit", "inherit"],
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Pager exited with code ${code}`));
      }
    });

    child.stdin.write(content);
    child.stdin.end();
  });
}

/**
 * Check if command exists
 */
function commandExists(command: string): boolean {
  try {
    const { execSync } = require("child_process");
    const cmd =
      platform() === "win32" ? `where ${command}` : `which ${command}`;
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear terminal screen
 */
export function clearTerminal(): void {
  if (platform() === "win32") {
    process.stdout.write("\x1Bc");
  } else {
    process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
  }
}

/**
 * Get hidden input (password-style)
 */
export async function getHiddenInput(message: string): Promise<string> {
  return await password({
    message,
    mask: "*",
  });
}

/**
 * Display multi-line warning for destructive operations
 */
export function displayWarning(lines: string[]): void {
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  const border = "⚠".repeat(width);

  console.log("");
  console.log(border);
  for (const line of lines) {
    console.log(`⚠  ${line}`);
  }
  console.log(border);
  console.log("");
}
