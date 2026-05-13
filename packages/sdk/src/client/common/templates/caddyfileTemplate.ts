import defaultCaddyfile from "./Caddyfile.default.tmpl";

/**
 * Default Caddyfile template bundled with the SDK.
 *
 * Serves two sites: ECLOUD_PLATFORM_HOST (the platform-derived
 * routing hostname, always present on platform-routed apps) and an
 * optional user DOMAIN. When a user drops a Caddyfile into cwd, the
 * image layering code uses that file instead of this default — the
 * default only kicks in when no user Caddyfile is found, which is
 * the common path for apps that just want the platform-routed
 * hostname to work out of the box.
 */
export function getDefaultCaddyfile(): string {
  return defaultCaddyfile;
}
