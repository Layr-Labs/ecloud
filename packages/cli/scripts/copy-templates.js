#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(__dirname, "..");
const sdkRoot = path.resolve(cliRoot, "../sdk");

// Template files to copy from SDK to CLI dist
const templates = [
  "src/client/common/templates/Dockerfile.layered.tmpl",
  "src/client/common/templates/compute-source-env.sh.tmpl",
];

// Create templates directory in CLI dist
const distTemplatesDir = path.join(cliRoot, "dist", "templates");
if (!fs.existsSync(distTemplatesDir)) {
  fs.mkdirSync(distTemplatesDir, { recursive: true });
}

// Copy each template file
for (const template of templates) {
  const srcPath = path.join(sdkRoot, template);
  const filename = path.basename(template);
  const destPath = path.join(distTemplatesDir, filename);

  if (!fs.existsSync(srcPath)) {
    console.warn(`Warning: Template file not found: ${srcPath}`);
    continue;
  }

  fs.copyFileSync(srcPath, destPath);
  console.log(`Copied ${filename} to dist/templates/`);
}

console.log("Template files copied successfully");

// Copy keys directory structure from SDK to CLI dist
const keysSrcDir = path.join(sdkRoot, "keys");
const keysDistDir = path.join(cliRoot, "dist", "keys");

if (fs.existsSync(keysSrcDir)) {
  // Copy entire keys directory structure recursively
  function copyDirRecursive(src, dest) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  copyDirRecursive(keysSrcDir, keysDistDir);

  console.log("Keys directory copied successfully");
} else {
  console.warn("Warning: Keys directory not found at", keysSrcDir);
}
