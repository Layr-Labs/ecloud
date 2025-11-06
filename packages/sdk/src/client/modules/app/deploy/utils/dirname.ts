import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * Get __dirname equivalent for ES modules
 * For CJS builds, tsup should handle the transformation
 */
export function getDirname(): string {
  // Use import.meta.url for ESM (CLI uses ESM)
  // @ts-expect-error - import.meta is only available in ESM, but we need it for CLI
  return path.dirname(fileURLToPath(import.meta.url));
}

