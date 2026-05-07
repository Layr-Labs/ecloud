#!/usr/bin/env tsx
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sdkRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(sdkRoot, "runtime-binaries", "ecloud-drain-watcher.json");
const toolsDir = path.join(sdkRoot, "tools");
const outputPath = path.join(toolsDir, "ecloud-drain-watcher-linux-amd64");

type Manifest = {
  name: string;
  version: string;
  oci: { image: string; binaryPath: string; binarySha256: string };
};

function isPlaceholder(value: string): boolean {
  return value.includes("TO_BE_FILLED") || value.includes("placeholder");
}

function run(cmd: string, args: string[], opts: { cwd?: string } = {}) {
  const res = spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8", ...opts });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout;
}

function dockerAvailable(): boolean {
  const res = spawnSync("docker", ["version"], { stdio: "ignore" });
  return res.status === 0;
}

function sha256File(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
  if (isPlaceholder(manifest.oci.image) || isPlaceholder(manifest.oci.binarySha256)) {
    console.warn(
      `Skipping ${manifest.name} fetch: runtime-binaries/ecloud-drain-watcher.json still contains placeholder artifact metadata.`,
    );
    return;
  }

  if (!dockerAvailable()) {
    throw new Error(`docker is required to extract ${manifest.name} from ${manifest.oci.image}`);
  }

  fs.mkdirSync(toolsDir, { recursive: true });
  const cid = run("docker", ["create", manifest.oci.image]).trim();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ecloud-runtime-binaries-"));
  const tmpOut = path.join(tmp, "ecloud-drain-watcher-linux-amd64");
  try {
    run("docker", ["cp", `${cid}:${manifest.oci.binaryPath}`, tmpOut]);
  } finally {
    spawnSync("docker", ["rm", cid], { stdio: "ignore" });
  }

  const got = sha256File(tmpOut);
  const want = manifest.oci.binarySha256.toLowerCase();
  if (got !== want) {
    throw new Error(`sha256 mismatch for ${manifest.name}: got ${got}, want ${want}`);
  }
  fs.copyFileSync(tmpOut, outputPath);
  fs.chmodSync(outputPath, 0o755);
  console.log(`Fetched ${manifest.name} ${manifest.version} -> ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
