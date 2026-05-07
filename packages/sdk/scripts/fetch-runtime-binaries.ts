#!/usr/bin/env tsx
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sdkRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(sdkRoot, "runtime-binaries", "ecloud-drain-watcher.json");
const toolsDir = path.join(sdkRoot, "tools");
const outputPath = path.join(toolsDir, "ecloud-drain-watcher-linux-amd64");

type Manifest = {
  name: string;
  version: string;
  download: { url: string; sha256: string };
};

function isPlaceholder(value: string): boolean {
  return value.includes("TO_BE_FILLED") || value.includes("placeholder");
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
  if (isPlaceholder(manifest.download.url) || isPlaceholder(manifest.download.sha256)) {
    console.warn(
      `Skipping ${manifest.name} fetch: runtime-binaries/ecloud-drain-watcher.json still contains placeholder artifact metadata.`,
    );
    return;
  }

  fs.mkdirSync(toolsDir, { recursive: true });
  const res = await fetch(manifest.download.url);
  if (!res.ok) {
    throw new Error(`failed to download ${manifest.name} ${manifest.version}: HTTP ${res.status}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  const got = crypto.createHash("sha256").update(bytes).digest("hex");
  const want = manifest.download.sha256.toLowerCase();
  if (got !== want) {
    throw new Error(`sha256 mismatch for ${manifest.name}: got ${got}, want ${want}`);
  }
  fs.writeFileSync(outputPath, bytes, { mode: 0o755 });
  fs.chmodSync(outputPath, 0o755);
  console.log(`Fetched ${manifest.name} ${manifest.version} -> ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
