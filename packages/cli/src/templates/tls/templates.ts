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

export interface TlsEnvVars {
  domain: string;
  appPort: string;
  acmeStaging: boolean;
  enableCaddyLogs: boolean;
}

/**
 * Generate the TLS env block with user-provided values for .env
 */
export function getTlsEnvBlock(vars: TlsEnvVars): string {
  return `
# TLS Configuration
DOMAIN=${vars.domain}
APP_PORT=${vars.appPort}
ENABLE_CADDY_LOGS=${vars.enableCaddyLogs}
ACME_STAGING=${vars.acmeStaging}
ACME_FORCE_ISSUE=false
`;
}

/**
 * Placeholder TLS block for .env.example
 */
export const TLS_ENV_EXAMPLE_BLOCK = `
# TLS Configuration
# DOMAIN=yourdomain.com
# APP_PORT=3000
# ENABLE_CADDY_LOGS=false
# ACME_STAGING=false
# ACME_FORCE_ISSUE=false
`;
