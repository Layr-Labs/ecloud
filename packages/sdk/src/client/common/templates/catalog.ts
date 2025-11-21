/**
 * Template catalog system
 *
 * Fetches and manages template catalog from templates.json
 */

import * as fs from "fs";
import * as path from "path";

// Environment variable names
export const ENV_VAR_USE_LOCAL_TEMPLATES = "EIGENX_USE_LOCAL_TEMPLATES";
export const ENV_VAR_TEMPLATES_PATH = "EIGENX_TEMPLATES_PATH";

// Default repository URL for templates
export const DEFAULT_TEMPLATE_REPO = "https://github.com/Layr-Labs/eigenx-templates";

// Default version/branch for templates
export const DEFAULT_TEMPLATE_VERSION = "main";

// Default catalog URL in the eigenx-templates repository
export const DEFAULT_CATALOG_URL =
  "https://raw.githubusercontent.com/Layr-Labs/eigenx-templates/main/templates.json";

// Cache duration for the catalog (15 minutes)
export const CATALOG_CACHE_DURATION = 15 * 60 * 1000; // 15 minutes in milliseconds

/**
 * TemplateEntry represents a single template in the catalog
 */
export interface TemplateEntry {
  path: string;
  description: string;
  postProcess?: {
    replaceNameIn?: string[];
  };
}

/**
 * TemplateCatalog represents the structure of templates.json
 * Organized by language first, then by category (e.g., "typescript" -> "minimal")
 */
export interface TemplateCatalog {
  [language: string]: {
    [category: string]: TemplateEntry;
  };
}

// In-memory cache
interface CatalogCache {
  catalog: TemplateCatalog | null;
  expiresAt: number;
}

let cache: CatalogCache = {
  catalog: null,
  expiresAt: 0,
};

/**
 * Fetch template catalog from remote URL or local file
 * Uses a 15-minute in-memory cache to avoid excessive network requests
 */
export async function fetchTemplateCatalog(): Promise<TemplateCatalog> {
  // Check if using local templates
  if (process.env[ENV_VAR_USE_LOCAL_TEMPLATES] === "true") {
    return fetchLocalCatalog();
  }

  // Check cache first
  if (cache.catalog && Date.now() < cache.expiresAt) {
    return cache.catalog;
  }

  // Fetch from remote
  const catalog = await fetchRemoteCatalog(DEFAULT_CATALOG_URL);

  // Update cache
  cache.catalog = catalog;
  cache.expiresAt = Date.now() + CATALOG_CACHE_DURATION;

  return catalog;
}

/**
 * Fetch catalog from remote URL
 */
async function fetchRemoteCatalog(url: string): Promise<TemplateCatalog> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000), // 10 second timeout
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch template catalog: HTTP ${response.status}`);
  }

  const data = await response.json();
  return data as TemplateCatalog;
}

/**
 * Fetch local catalog from templates.json file
 */
function fetchLocalCatalog(): TemplateCatalog {
  // Look for EIGENX_TEMPLATES_PATH first
  let templatesPath = process.env[ENV_VAR_TEMPLATES_PATH];

  if (!templatesPath) {
    // Look for eigenx-templates directory as a sibling
    const cwd = process.cwd();
    const possiblePaths = [
      path.join(cwd, "eigenx-templates"),
      path.join(path.dirname(cwd), "eigenx-templates"),
    ];

    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        templatesPath = possiblePath;
        break;
      }
    }

    if (!templatesPath) {
      throw new Error(
        "Local templates directory not found. Set EIGENX_TEMPLATES_PATH or ensure eigenx-templates is a sibling directory",
      );
    }
  }

  const catalogPath = path.join(templatesPath, "templates.json");
  if (!fs.existsSync(catalogPath)) {
    throw new Error(`Local template catalog not found at ${catalogPath}`);
  }

  const data = fs.readFileSync(catalogPath, "utf-8");
  return JSON.parse(data) as TemplateCatalog;
}

/**
 * Get template entry by language and category
 */
export function getTemplate(
  catalog: TemplateCatalog,
  category: string,
  language: string,
): TemplateEntry {
  const templates = catalog[language];
  if (!templates) {
    throw new Error(`Language "${language}" not found in catalog`);
  }

  const template = templates[category];
  if (!template) {
    throw new Error(`Category "${category}" not found for language "${language}"`);
  }

  return template;
}

/**
 * Get category descriptions for a given language
 */
export function getCategoryDescriptions(
  catalog: TemplateCatalog,
  language: string,
): Record<string, string> {
  const templates = catalog[language];
  if (!templates) {
    return {};
  }

  const descriptions: Record<string, string> = {};
  for (const [category, template] of Object.entries(templates)) {
    descriptions[category] = template.description || "";
  }

  return descriptions;
}

