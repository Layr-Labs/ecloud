#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sdkRoot = path.resolve(__dirname, "..");

// Template files to copy from SDK src to SDK dist
const templates = [
  "src/client/common/templates/Dockerfile.layered.tmpl",
  "src/client/common/templates/compute-source-env.sh.tmpl",
];

// Create templates directory in SDK dist
const distTemplatesDir = path.join(sdkRoot, "dist", "templates");
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

// Copy keys directory structure
const keysSrcDir = path.join(sdkRoot, "keys");
const keysDistDir = path.join(sdkRoot, "dist", "keys");

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
