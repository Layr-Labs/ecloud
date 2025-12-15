/**
 * Version Command
 *
 * Display the CLI version and commit SHA
 */

import { Command } from "@oclif/core";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { withTelemetry } from "../telemetry";
import { fileURLToPath } from "url";

interface VersionInfo {
  version: string;
  commit: string;
}

function readVersionFile(): VersionInfo | null {
  try {
    // Get the directory of the current module
    const currentFile = fileURLToPath(import.meta.url);
    const currentDir = path.dirname(currentFile);

    // Navigate to package root
    const packageRoot = path.resolve(currentDir, "../..");
    const versionFilePath = path.join(packageRoot, "VERSION");

    if (!fs.existsSync(versionFilePath)) {
      return null;
    }

    const content = fs.readFileSync(versionFilePath, "utf8");
    const lines = content.trim().split("\n");

    const versionInfo: VersionInfo = {
      version: "unknown",
      commit: "unknown",
    };

    for (const line of lines) {
      const [key, ...valueParts] = line.split("=");
      const value = valueParts.join("=").trim();

      if (key === "version") {
        versionInfo.version = value;
      } else if (key === "commit") {
        versionInfo.commit = value;
      }
    }

    return versionInfo;
  } catch {
    return null;
  }
}

export default class Version extends Command {
  static description = "Display the CLI version and commit SHA";

  static examples = ["<%= config.bin %> <%= command.id %>"];

  async run(): Promise<void> {
    return withTelemetry(this, async () => {
      const versionInfo = readVersionFile();

      // Version will always be present when published, for unpublished pull from current env
      if (!versionInfo) {
        this.log(`Version: ${this.config.version} (unpublished)`);

        // Attempt to get version from package root
        try {
          // Pull current working dir to pull commit hash
          const __dirname = path.dirname(fileURLToPath(import.meta.url));
          const packageRoot = path.resolve(__dirname, "..");

          // Print the short sha from the projects root .git dir
          // Run git directly, setting cwd so no shell expansion/risk
          const commitSha = execSync("git rev-parse --short HEAD", {
            cwd: packageRoot,
            encoding: "utf8",
          }).trim();
          this.log(`Commit: ${commitSha}`);
        } catch {
          // If we can't get the commit then print unknown
          this.log(`Commit: unknown`);
        }

        return;
      }

      this.log(`Version: ${versionInfo.version}`);
      this.log(`Commit:  ${versionInfo.commit}`);
    });
  }
}
