/**
 * ESM and CJS compatible getDirname utility
 */

import * as path from "path";
import { fileURLToPath } from "url";

/**
 * Get __dirname equivalent that works in both ESM and CJS
 * In CJS builds, __dirname is available and will be used
 * In ESM builds, import.meta.url is used
 */
export function getDirname(): string {
  // Check for CJS __dirname first (available in CommonJS)
  if (typeof __dirname !== "undefined") {
    return __dirname;
  }

  // For ESM, we need to use import.meta.url
  // This will be evaluated at build time by tsup for ESM builds
  // For CJS builds, the above check will catch it, so this won't execute
  try {
    const metaUrl = import.meta.url;
    return path.dirname(fileURLToPath(metaUrl));
  } catch {
    // Fallback (shouldn't reach here in normal usage)
    return process.cwd();
  }
}
