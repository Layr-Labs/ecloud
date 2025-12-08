#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

// Get version and commit from environment variables
const version = process.env.PACKAGE_VERSION || process.env.VERSION?.replace(/^v/, "") || "unknown";
const commit = process.env.GITHUB_SHA || process.env.COMMIT_SHA || "unknown";

// Create VERSION file content
const versionContent = `version=${version}
commit=${commit}
`;

// Write VERSION file to package root
const versionFilePath = path.join(packageRoot, "VERSION");
fs.writeFileSync(versionFilePath, versionContent, "utf8");

console.log(`Generated VERSION file: ${versionFilePath}`);
console.log(`  version: ${version}`);
console.log(`  commit: ${commit}`);
