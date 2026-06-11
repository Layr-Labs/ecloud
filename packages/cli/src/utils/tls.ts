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

/**
 * Warning shown at deploy/upgrade when DOMAIN is unset (TLS off): the app will
 * run, but nothing binds ports 80/443, so HTTP(S) requests are refused.
 */
export const TLS_DISABLED_WARNING =
  "DOMAIN not set → ports 80/443 will not be reachable. Run `ecloud compute app configure tls` to enable HTTPS.";

/**
 * Static TLS line for `app info`. DOMAIN is encrypted (private env), so the
 * actual on/off state can't be read back from the server — this is informational.
 */
export const TLS_INFO_LINE =
  "Set via DOMAIN env (not shown here). If unset, ports 80/443 are closed — run `ecloud compute app configure tls`.";
