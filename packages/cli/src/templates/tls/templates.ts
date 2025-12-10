/**
 * TLS configuration templates
 *
 * These templates are used by the `configure tls` command to create
 * TLS configuration files in the user's project.
 *
 * Similar to Go's //go:embed, we load templates from files.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

/**
 * Find the templates directory
 * Works both in development (src/) and production (dist/)
 *
 * Note: When bundled by tsup, this code gets inlined into the command file,
 * so import.meta.url points to the command location, not the templates location.
 * We walk up the directory tree to find the templates directory.
 */
function findTemplatesDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  let currentDir = path.dirname(__filename);

  // Walk up to find the dist or src root that contains templates/tls/
  const maxDepth = 10;
  for (let i = 0; i < maxDepth; i++) {
    const templatePath = path.join(currentDir, "templates", "tls", "Caddyfile.tmpl");
    if (fs.existsSync(templatePath)) {
      return path.join(currentDir, "templates", "tls");
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  throw new Error("Could not find TLS templates directory");
}

/**
 * Load the Caddyfile template
 */
export function getCaddyfileTemplate(): string {
  const templatesDir = findTemplatesDir();
  const templatePath = path.join(templatesDir, "Caddyfile.tmpl");
  return fs.readFileSync(templatePath, "utf-8");
}

/**
 * Embedded .env.example.tls content
 * (embedded directly since .env files are gitignored)
 */
export const ENV_EXAMPLE_TLS = `# TLS Configuration
# Set these variables to enable TLS for your application

# Your domain name (required for TLS)
DOMAIN=yourdomain.com

# Port your application listens on
APP_PORT=3000

# Enable Caddy debug logs
ENABLE_CADDY_LOGS=false

# Use Let's Encrypt staging environment (for testing)
# Set to true to avoid rate limits during development
ACME_STAGING=false

# Force certificate reissue even if a valid one exists
# Useful when you need to update SANs or force a renewal
ACME_FORCE_ISSUE=false
`;
