import type { AppRelease, AppReleaseBuild } from "@layr-labs/ecloud-sdk";
import chalk from "chalk";
import { formatDependencyLines, formatSourceLink } from "./build";

type JsonObject = Record<string, unknown>;
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortedKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).sort((a, b) => a.localeCompare(b));
}

function formatPublicEnv(publicEnv: AppRelease["publicEnv"]): string[] {
  if (!publicEnv) return [];

  // UserAPI currently returns this as a JSON string.
  if (typeof publicEnv === "string") {
    try {
      const parsed = JSON.parse(publicEnv) as Record<string, unknown>;
      if (Object.keys(parsed).length === 0) return [];
      const lines: string[] = [];
      lines.push(chalk.gray("publicEnv:"));
      for (const k of sortedKeys(parsed)) {
        const v = parsed[k];
        lines.push(`  ${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
      }
      return lines;
    } catch {
      return [`publicEnv: ${publicEnv}`];
    }
  }

  // Fallback (if backend changes shape later)
  if (isJsonObject(publicEnv) && !("BYTES_PER_ELEMENT" in publicEnv)) {
    if (Object.keys(publicEnv).length === 0) return [];
    const lines: string[] = [];
    lines.push(chalk.gray("publicEnv:"));
    for (const k of sortedKeys(publicEnv)) {
      const v = publicEnv[k];
      lines.push(`  ${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
    }
    return lines;
  }

  return [`publicEnv: ${chalk.gray("<unavailable>")}`];
}

function formatMaybe(label: string, value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value);
  if (!s) return undefined;
  return `${label}: ${s}`;
}

function buildSummaryLines(build?: AppReleaseBuild): string[] {
  if (!build) return [chalk.gray("Build: -")];

  const lines: string[] = [];
  lines.push(chalk.green("Build:"));

  if (build.buildId) lines.push(`  build_id: ${build.buildId}`);
  if (build.buildType) lines.push(`  build_type: ${build.buildType}`);

  if (build.repoUrl && build.gitRef) {
    lines.push(`  repo_url: ${build.repoUrl}`);
    lines.push(`  git_ref: ${build.gitRef}`);
    lines.push(`  source: ${formatSourceLink(build.repoUrl, build.gitRef)}`);
  } else {
    if (build.repoUrl) lines.push(`  repo_url: ${build.repoUrl}`);
    if (build.gitRef) lines.push(`  git_ref: ${build.gitRef}`);
  }

  if (build.imageUrl) lines.push(`  image_url: ${build.imageUrl}`);
  if (build.imageDigest) lines.push(`  image_digest: ${build.imageDigest}`);
  if (build.provenanceSignature) lines.push(`  provenance_signature: ${build.provenanceSignature}`);
  if (build.createdAt) lines.push(`  created_at: ${build.createdAt}`);

  const deps = build.dependencies;
  if (deps && Object.keys(deps).length > 0) {
    const depMap: Record<string, { repoUrl: string; gitRef: string }> = {};
    for (const [digest, dep] of Object.entries(deps) as Array<[string, AppReleaseBuild]>) {
      if (dep.repoUrl && dep.gitRef) {
        depMap[digest] = { repoUrl: dep.repoUrl, gitRef: dep.gitRef };
      }
    }
    const depLines = formatDependencyLines(depMap);
    if (depLines.length) {
      lines.push("");
      lines.push(...depLines.map((l) => (l ? `  ${l}` : l)));
    }
  }

  return lines;
}

export function formatAppRelease(release: AppRelease, index: number): string[] {
  const lines: string[] = [];
  const id = release.rmsReleaseId ?? String(index);

  lines.push(chalk.cyan.bold(`Release ${id}`));

  const headerFields = [
    formatMaybe("createdAt", release.createdAt),
    formatMaybe("createdAtBlock", release.createdAtBlock),
    formatMaybe("upgradeByTime", release.upgradeByTime),
    formatMaybe("registryUrl", release.registryUrl),
    formatMaybe("imageDigest", release.imageDigest),
  ].filter(Boolean) as string[];
  lines.push(...headerFields);

  const pub = formatPublicEnv(release.publicEnv);
  if (pub.length) {
    lines.push("");
    lines.push(...pub);
  }

  lines.push("");
  lines.push(...buildSummaryLines(release.build));

  return lines;
}
