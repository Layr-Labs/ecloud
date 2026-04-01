/**
 * Dashboard URL utilities for different environments
 */

const DASHBOARD_URLS: Record<string, string> = {
  "sepolia-dev": "https://compute-dashboard-sepolia-dev.vercel.app",
  sepolia: "https://verify-sepolia.eigencloud.xyz",
  "mainnet-alpha": "https://verify.eigencloud.xyz",
};

/**
 * Get the dashboard URL for an app in a given environment
 * @param environment - The environment (sepolia-dev, sepolia, mainnet-alpha)
 * @param appAddress - The app contract address (0x...)
 * @returns The full dashboard URL for the app
 */
export function getDashboardUrl(environment: string, appAddress: string): string {
  const baseUrl = DASHBOARD_URLS[environment] || DASHBOARD_URLS["sepolia"];
  return `${baseUrl}/app/${appAddress}`;
}
