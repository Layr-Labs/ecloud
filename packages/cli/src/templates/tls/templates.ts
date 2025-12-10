/**
 * TLS configuration templates
 */

import caddyfileTemplate from "./Caddyfile.tmpl";

/**
 * Get the Caddyfile template
 */
export function getCaddyfileTemplate(): string {
  return caddyfileTemplate;
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
