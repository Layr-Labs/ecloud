import fs from "fs";

/**
 * Determine whether TLS should be enabled for an app based on DOMAIN.
 *
 * Rules (kept consistent with SDK local layering):
 * - If DOMAIN is missing/empty: TLS disabled
 * - If DOMAIN is "localhost": TLS disabled
 */
export function isTlsEnabledFromDomain(domain: string | undefined): boolean {
  const d = (domain ?? "").trim();
  if (!d) return false;
  if (d.toLowerCase() === "localhost") return false;
  return true;
}

/**
 * Best-effort: check DOMAIN in an env file (simple KEY=VALUE parsing).
 * Returns true if DOMAIN is set and not localhost.
 */
export function isTlsEnabledFromEnvFile(envFilePath: string | undefined): boolean {
  if (!envFilePath) return false;
  if (!fs.existsSync(envFilePath)) return false;
  const envContent = fs.readFileSync(envFilePath, "utf-8");
  const match = envContent.match(/^DOMAIN=(.+)$/m);
  if (!match?.[1]) return false;
  return isTlsEnabledFromDomain(match[1]);
}
