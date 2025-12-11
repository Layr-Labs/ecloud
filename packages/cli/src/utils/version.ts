/**
 * CLI version utilities
 *
 * CLI_VERSION_BUILD_TIME is replaced at build time by tsup's define option
 */

// @ts-ignore - CLI_VERSION_BUILD_TIME is injected at build time by tsup
declare const CLI_VERSION_BUILD_TIME: string | undefined;

/**
 * Get the CLI version
 */
export function getCliVersion(): string {
  // @ts-ignore - CLI_VERSION_BUILD_TIME is injected at build time
  return typeof CLI_VERSION_BUILD_TIME !== "undefined" ? CLI_VERSION_BUILD_TIME : "0.0.0";
}

/**
 * Get the x-client-id header value for API calls
 */
export function getClientId(): string {
  return `ecloud-cli/v${getCliVersion()}`;
}
