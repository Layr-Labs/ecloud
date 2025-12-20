import type { Build } from "@layr-labs/ecloud-sdk";
import { BUILD_STATUS } from "@layr-labs/ecloud-sdk";
import chalk from "chalk";
import { formatSourceLink } from "./build";

export interface FormatBuildInfoOptions {
  /** Indent prefix for all lines */
  indent?: string;
  /** Include dependencies recursively */
  includeDependencies?: boolean;
  /** Max chars for provenance_json in text mode */
  maxProvenanceJsonChars?: number;
}

function sortedEntries<T>(obj: Record<string, T>): Array<[string, T]> {
  return Object.entries(obj).sort(([a], [b]) => a.localeCompare(b));
}

function indentLines(lines: string[], indent: string): string[] {
  return lines.map((l) => (l === "" ? "" : `${indent}${l}`));
}

export function formatBuildStatus(status: Build["status"]): string {
  const s = status as (typeof BUILD_STATUS)[keyof typeof BUILD_STATUS];
  const color = {
    [BUILD_STATUS.BUILDING]: chalk.yellow,
    [BUILD_STATUS.SUCCESS]: chalk.green,
    [BUILD_STATUS.FAILED]: chalk.red,
  }[s];
  return color ? color(status) : status;
}

function kv(label: string, value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const str = String(value);
  if (!str) return undefined;
  return `${chalk.cyan(label)}: ${str}`;
}

export function formatBuildInfo(build: Build, opts: FormatBuildInfoOptions = {}): string[] {
  const { indent = "", includeDependencies = true, maxProvenanceJsonChars = 200 } = opts;

  const lines: string[] = [];

  lines.push(`${indent}${chalk.cyan("build_id")}: ${build.buildId}`);
  lines.push(`${indent}${chalk.cyan("repo_url")}: ${build.repoUrl}`);
  lines.push(`${indent}${chalk.cyan("git_ref")}: ${build.gitRef}`);
  lines.push(`${indent}${chalk.cyan("source")}: ${formatSourceLink(build.repoUrl, build.gitRef)}`);
  lines.push(`${indent}${chalk.cyan("status")}: ${formatBuildStatus(build.status)}`);
  lines.push(`${indent}${chalk.cyan("build_type")}: ${build.buildType}`);

  const optionalLines = [
    kv("image_name", build.imageName),
    kv("image_digest", build.imageDigest),
    kv("image_url", build.imageUrl),
    build.provenanceJson !== undefined
      ? (() => {
          const json = JSON.stringify(build.provenanceJson);
          const printable =
            json.length <= maxProvenanceJsonChars
              ? json
              : `${json.slice(0, maxProvenanceJsonChars)}… (use --json)`;
          return `${chalk.cyan("provenance_json")}: ${printable}`;
        })()
      : undefined,
    kv("provenance_signature", build.provenanceSignature),
    kv("created_at", build.createdAt),
    kv("updated_at", build.updatedAt),
    build.errorMessage
      ? `${chalk.cyan("error_message")}: ${chalk.red(build.errorMessage)}`
      : undefined,
  ].filter(Boolean) as string[];

  for (const l of optionalLines) lines.push(`${indent}${l}`);

  if (!includeDependencies) return lines;

  const deps = build.dependencies;
  if (deps && Object.keys(deps).length > 0) {
    lines.push("");
    lines.push(`${indent}${chalk.cyan.bold("dependencies")}:`);

    for (const [digest, dep] of sortedEntries(deps)) {
      lines.push(`${indent}- ${digest}`);
      lines.push(...indentLines(formatBuildInfo(dep, { ...opts, indent: "" }), `${indent}  `));
      lines.push("");
    }

    while (lines.length && lines[lines.length - 1] === "") lines.pop();
  }

  return lines;
}
