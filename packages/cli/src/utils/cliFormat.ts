/**
 * Shared CLI formatting helpers (dependency-free).
 *
 * NOTE: Table rendering should use `cli-table3` directly.
 */
export function terminalWidth(fallback = 120): number {
  const cols = typeof process.stdout.columns === "number" ? process.stdout.columns : undefined;
  return cols && cols > 0 ? cols : fallback;
}

/**
 * Formats an ISO string OR a unix epoch (seconds or ms) into a readable local time.
 * If it can't parse, returns the raw value.
 */
export function formatHumanTime(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "-";

  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      const ms = raw.length <= 10 ? n * 1000 : n;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d.toLocaleString();
    }
    return raw;
  }

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString();
}

export function formatRepoDisplay(repoUrl: string): string {
  const normalized = String(repoUrl || "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  try {
    const url = new URL(normalized);
    const host = url.host.toLowerCase();
    if (host === "github.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) return `github.com/${parts[0]}/${parts[1]}`;
    }
    return `${host}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return normalized;
  }
}

export function extractRepoName(repoUrl: string): string {
  const normalized = String(repoUrl || "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  try {
    const url = new URL(normalized);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : normalized;
  } catch {
    const m = normalized.match(/[:/]+([^/:]+)$/);
    return m?.[1] || normalized || "unknown";
  }
}

export function formatImageDisplay(imageUrl: string): string {
  const s = String(imageUrl || "");
  return s.replace(/^docker\.io\//i, "");
}

export function provenanceSummary(options: {
  provenanceJson?: unknown;
  provenanceSignature?: string;
  dependencies?: Record<string, unknown>;
}): string {
  const parts: string[] = [];
  if (options.provenanceJson) parts.push("prov✓");
  if (options.provenanceSignature) parts.push("sig✓");
  const depCount = options.dependencies ? Object.keys(options.dependencies).length : 0;
  if (depCount > 0) parts.push(`deps:${depCount}`);
  return parts.length ? parts.join(" ") : "-";
}


