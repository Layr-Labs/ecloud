/**
 * Create command
 *
 * Creates a new app project from a template
 * 
 * NOTE: This SDK function is non-interactive. All required parameters must be
 * provided explicitly. Use the CLI for interactive parameter collection.
 */

import * as fs from "fs";
import * as path from "path";
import { Logger } from "../../common/types";
import { defaultLogger } from "../../common/utils";
import {
  fetchTemplateCatalog,
  getTemplate,
  getCategoryDescriptions,
  DEFAULT_TEMPLATE_REPO,
  DEFAULT_TEMPLATE_VERSION,
  ENV_VAR_USE_LOCAL_TEMPLATES,
  ENV_VAR_TEMPLATES_PATH,
  type TemplateEntry,
} from "../../common/templates/catalog";
import { fetchTemplate, fetchTemplateSubdirectory } from "../../common/templates/git";
import { postProcessTemplate } from "../../common/templates/postprocess";

/**
 * Required create app options for SDK (non-interactive)
 */
export interface SDKCreateAppOpts {
  /** Project name - required */
  name: string;
  /** Programming language - required (typescript, golang, rust, python) */
  language: string;
  /** Template name/category (e.g., "minimal") or custom template URL - optional, defaults to first available */
  template?: string;
  /** Template version/ref - optional */
  templateVersion?: string;
  /** Verbose output - optional */
  verbose?: boolean;
}

/**
 * Legacy interface for backward compatibility
 * @deprecated Use SDKCreateAppOpts instead
 */
export interface CreateAppOpts {
  name?: string;
  language?: string;
  template?: string;
  templateVersion?: string;
  verbose?: boolean;
}

// Language configuration
export const PRIMARY_LANGUAGES = ["typescript", "golang", "rust", "python"];

export const SHORT_NAMES: Record<string, string> = {
  ts: "typescript",
  go: "golang",
  rs: "rust",
  py: "python",
};

export const LANGUAGE_FILES: Record<string, string[]> = {
  typescript: ["package.json"],
  rust: ["Cargo.toml", "Dockerfile"],
  golang: ["go.mod"],
};

/**
 * Project configuration
 */
interface ProjectConfig {
  name: string;
  language?: string;
  templateName?: string;
  templateEntry?: TemplateEntry;
  repoURL: string;
  ref: string;
  subPath: string;
}

/**
 * Validate project name
 */
function validateProjectName(name: string): void {
  if (!name) {
    throw new Error("Project name is required");
  }
  if (name.includes(" ")) {
    throw new Error("Project name cannot contain spaces");
  }
}

/**
 * Validate language
 */
function validateLanguage(language: string): string {
  if (!language) {
    throw new Error("Language is required");
  }

  // Resolve short names to full names
  const resolvedLanguage = SHORT_NAMES[language] || language;

  // Validate against primary languages
  if (!PRIMARY_LANGUAGES.includes(resolvedLanguage)) {
    throw new Error(
      `Invalid language: ${language}. Must be one of: ${PRIMARY_LANGUAGES.join(", ")} (or short: ${Object.keys(SHORT_NAMES).join(", ")})`
    );
  }

  return resolvedLanguage;
}

/**
 * Check if a string is a URL
 */
function isURL(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get available template categories for a language
 */
export async function getAvailableTemplates(
  language: string
): Promise<Array<{ name: string; description: string }>> {
  const catalog = await fetchTemplateCatalog();
  const categoryDescriptions = getCategoryDescriptions(catalog, language);

  if (Object.keys(categoryDescriptions).length === 0) {
    throw new Error(`No templates found for language ${language}`);
  }

  // Sort categories alphabetically for consistent ordering
  const categories = Object.keys(categoryDescriptions).sort();

  return categories.map((category) => ({
    name: category,
    description: categoryDescriptions[category] || "",
  }));
}

/**
 * Create a new app project from template
 * 
 * This function is non-interactive and requires all parameters to be provided explicitly.
 * 
 * @param options - Required options including name and language
 * @param logger - Optional logger instance
 * @throws Error if required parameters are missing or invalid
 */
export async function createApp(
  options: SDKCreateAppOpts | CreateAppOpts,
  logger: Logger = defaultLogger,
): Promise<void> {
  // 1. Validate required parameters
  validateProjectName(options.name || "");
  const language = validateLanguage(options.language || "");

  // 2. Gather project configuration
  const cfg = await gatherProjectConfig(
    {
      ...options,
      name: options.name!,
      language,
    },
    logger
  );

  // 3. Check if directory exists
  if (fs.existsSync(cfg.name)) {
    throw new Error(`Directory ${cfg.name} already exists`);
  }

  // 4. Create project directory
  fs.mkdirSync(cfg.name, { mode: 0o755 });

  try {
    // 5. Populate project from template
    await populateProjectFromTemplate(cfg, options, logger);

    // 6. Post-process template
    if (cfg.subPath && cfg.language && cfg.templateEntry) {
      await postProcessTemplate(
        cfg.name,
        cfg.language,
        cfg.templateEntry,
        logger,
      );
    }

    logger.info(`Successfully created ${cfg.language || "project"} project: ${cfg.name}`);
  } catch (error: any) {
    // Cleanup on failure
    fs.rmSync(cfg.name, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Gather project configuration (non-interactive)
 */
async function gatherProjectConfig(
  options: { name: string; language: string; template?: string; templateVersion?: string },
  logger: Logger,
): Promise<ProjectConfig> {
  const cfg: ProjectConfig = {
    repoURL: DEFAULT_TEMPLATE_REPO,
    ref: DEFAULT_TEMPLATE_VERSION,
    subPath: "",
    name: options.name,
  };

  // Handle custom template repo (if template is a URL)
  const customTemplateRepo = options.template;
  if (customTemplateRepo && isURL(customTemplateRepo)) {
    cfg.repoURL = customTemplateRepo;
    cfg.ref = options.templateVersion || DEFAULT_TEMPLATE_VERSION;
    return cfg;
  }

  // Handle built-in templates
  cfg.language = options.language;

  // Get template name (category)
  let templateName = customTemplateRepo; // If provided and not a URL, it's a template name
  
  if (!templateName) {
    // Default to first available template for the language
    const availableTemplates = await getAvailableTemplates(options.language);
    if (availableTemplates.length === 0) {
      throw new Error(`No templates found for language ${options.language}`);
    }
    templateName = availableTemplates[0].name;
    logger.debug(`Using default template: ${templateName}`);
  }
  cfg.templateName = templateName;

  // Resolve template details from catalog
  const catalog = await fetchTemplateCatalog();
  const matchedTemplate = getTemplate(catalog, templateName, options.language);
  cfg.templateEntry = matchedTemplate;
  cfg.repoURL = DEFAULT_TEMPLATE_REPO;
  cfg.ref = options.templateVersion || DEFAULT_TEMPLATE_VERSION;
  cfg.subPath = matchedTemplate.path;

  return cfg;
}

/**
 * Populate project from template
 */
async function populateProjectFromTemplate(
  cfg: ProjectConfig,
  options: { verbose?: boolean },
  logger: Logger,
): Promise<void> {
  // Handle local templates for development
  if (process.env[ENV_VAR_USE_LOCAL_TEMPLATES] === "true") {
    let eigenxTemplatesPath = process.env[ENV_VAR_TEMPLATES_PATH];
    if (!eigenxTemplatesPath) {
      // Look for eigenx-templates as a sibling directory
      const possiblePaths = ["eigenx-templates", "../eigenx-templates"];
      for (const possiblePath of possiblePaths) {
        const testPath = path.join(possiblePath, "templates");
        if (fs.existsSync(testPath)) {
          eigenxTemplatesPath = possiblePath;
          break;
        }
      }
      if (!eigenxTemplatesPath) {
        throw new Error(
          `Cannot find eigenx-templates directory. Set ${ENV_VAR_TEMPLATES_PATH} or ensure eigenx-templates is a sibling directory`,
        );
      }
    }

    const localTemplatePath = path.join(eigenxTemplatesPath, cfg.subPath);
    if (!fs.existsSync(localTemplatePath)) {
      throw new Error(`Local template not found at ${localTemplatePath}`);
    }

    await copyDirectory(localTemplatePath, cfg.name);
    logger.info(`Using local template from ${localTemplatePath}`);
    return;
  }

  // Fetch from remote repository
  if (cfg.subPath) {
    await fetchTemplateSubdirectory(
      cfg.repoURL,
      cfg.ref,
      cfg.subPath,
      cfg.name,
      logger,
    );
  } else {
    await fetchTemplate(
      cfg.repoURL,
      cfg.ref,
      cfg.name,
      { verbose: options.verbose || false },
      logger,
    );
  }
}

/**
 * Copy directory recursively
 */
async function copyDirectory(src: string, dst: string): Promise<void> {
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(dstPath, { recursive: true });
      await copyDirectory(srcPath, dstPath);
    } else {
      const stat = fs.statSync(srcPath);
      fs.copyFileSync(srcPath, dstPath);
      fs.chmodSync(dstPath, stat.mode);
    }
  }
}
