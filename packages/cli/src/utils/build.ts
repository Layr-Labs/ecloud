/**
 * Formatting helpers for verifiable build UX
 */

/**
 * Format a source link for a repo+gitRef.
 *
 * - GitHub HTTPS URLs: `https://github.com/<owner>/<repo>/tree/<sha>`
 * - GitHub URLs ending in `.git`: strips `.git`
 * - Non-GitHub: falls back to `<repoUrl>@<sha>`
 */
export function formatSourceLink(repoUrl: string, gitRef: string): string {
  const normalizedRepo = repoUrl.replace(/\.git$/, "");

  try {
    const url = new URL(normalizedRepo);
    const host = url.host.toLowerCase();
    if (host === "github.com") {
      const path = url.pathname.replace(/\/+$/, "");
      if (path.split("/").filter(Boolean).length >= 2) {
        return `https://github.com${path}/tree/${gitRef}`;
      }
    }
  } catch {
    // repoUrl might not be a fully-qualified URL (e.g. git@github.com:owner/repo)
  }

  return `${repoUrl}@${gitRef}`;
}

function extractRepoName(repoUrl: string): string | undefined {
  const normalized = repoUrl.replace(/\.git$/, "");
  const match = normalized.match(/\/([^/]+?)$/);
  return match?.[1];
}

export function formatDependencyLines(
  dependencies?: Record<string, { repoUrl: string; gitRef: string }>,
) {
  if (!dependencies || Object.keys(dependencies).length === 0) return [];

  const lines: string[] = [];
  lines.push("Dependencies (resolved builds):");
  for (const [digest, dep] of Object.entries(dependencies)) {
    const name = extractRepoName(dep.repoUrl);
    const depSource = formatSourceLink(dep.repoUrl, dep.gitRef);
    lines.push(`  - ${digest} ✓${name ? ` ${name}` : ""}`);
    lines.push(`    ${depSource}`);
  }
  return lines;
}

export function formatVerifiableBuildSummary(options: {
  buildId?: string;
  imageUrl: string;
  imageDigest: string;
  repoUrl: string;
  gitRef: string;
  dependencies?: Record<string, { repoUrl: string; gitRef: string }>;
  provenanceSignature: string;
}): string[] {
  const lines: string[] = [];

  lines.push("Build completed successfully ✓");
  lines.push("");
  lines.push(`Image:  ${options.imageUrl}`);
  lines.push(`Digest: ${options.imageDigest}`);
  lines.push(`Source: ${formatSourceLink(options.repoUrl, options.gitRef)}`);

  const depLines = formatDependencyLines(options.dependencies);
  if (depLines.length) {
    lines.push("");
    lines.push(...depLines);
  }

  lines.push("");
  lines.push("Provenance signature verified ✓");
  lines.push(`provenance_signature: ${options.provenanceSignature}`);
  if (options.buildId) {
    lines.push("");
    lines.push(`Build ID: ${options.buildId}`);
  }

  return lines;
}
