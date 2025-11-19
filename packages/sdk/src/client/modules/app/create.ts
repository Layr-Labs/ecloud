/**
 * Create command
 *
 * Creates a new app project from a template
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
import { input, select } from "@inquirer/prompts";

export interface CreateAppOpts {
  name?: string;
  language?: string;
  template?: string; // Template name/category (e.g., "minimal") or custom template URL
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
 * Create a new app project from template
 */
export async function createApp(
  options: CreateAppOpts,
  logger: Logger = defaultLogger,
): Promise<void> {
  // 1. Gather project configuration
  const cfg = await gatherProjectConfig(options, logger);

  // 2. Check if directory exists
  if (fs.existsSync(cfg.name)) {
    throw new Error(`Directory ${cfg.name} already exists`);
  }

  // 3. Create project directory
  fs.mkdirSync(cfg.name, { mode: 0o755 });

  try {
    // 4. Populate project from template
    await populateProjectFromTemplate(cfg, options, logger);

    // 5. Post-process template
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
 * Validate project name
 */
function validateProjectName(name: string): void {
  if (!name) {
    throw new Error("Project name cannot be empty");
  }
  if (name.includes(" ")) {
    throw new Error("Project name cannot contain spaces");
  }
}

/**
 * Gather project configuration
 */
async function gatherProjectConfig(
  options: CreateAppOpts,
  logger: Logger,
): Promise<ProjectConfig> {
  const cfg: ProjectConfig = {
    repoURL: DEFAULT_TEMPLATE_REPO,
    ref: DEFAULT_TEMPLATE_VERSION,
    subPath: "",
    name: "",
  };

  // 1. Get project name
  let name = options.name;
  if (!name) {
    name = await promptProjectName();
  }
  // Validate project name
  validateProjectName(name);
  cfg.name = name;

  // 2. Handle custom template repo (if template is a URL)
  const customTemplateRepo = options.template;
  if (customTemplateRepo && isURL(customTemplateRepo)) {
    cfg.repoURL = customTemplateRepo;
    cfg.ref = options.templateVersion || DEFAULT_TEMPLATE_VERSION;
    return cfg;
  }

  // 3. Handle built-in templates
  // Get language
  let language = options.language;
  if (!language) {
    language = await promptLanguage();
  } else {
    // Resolve short names to full names
    if (SHORT_NAMES[language]) {
      language = SHORT_NAMES[language];
    }
  }
  cfg.language = language;

  // Get template name (category)
  let templateName = customTemplateRepo; // If provided and not a URL, it's a template name
  if (!templateName) {
    templateName = await selectTemplateInteractive(language, logger);
  }
  cfg.templateName = templateName;

  // Resolve template details from catalog
  const catalog = await fetchTemplateCatalog();
  const matchedTemplate = getTemplate(catalog, templateName, language);
  cfg.templateEntry = matchedTemplate;
  cfg.repoURL = DEFAULT_TEMPLATE_REPO;
  cfg.ref = options.templateVersion || DEFAULT_TEMPLATE_VERSION;
  cfg.subPath = matchedTemplate.path;

  return cfg;
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
 * Select template interactively
 */
async function selectTemplateInteractive(
  language: string,
  logger: Logger,
): Promise<string> {
  const catalog = await fetchTemplateCatalog();
  const categoryDescriptions = getCategoryDescriptions(catalog, language);

  if (Object.keys(categoryDescriptions).length === 0) {
    throw new Error(`No templates found for language ${language}`);
  }

  // Sort categories alphabetically for consistent ordering
  const categories = Object.keys(categoryDescriptions).sort();

  // Build display options: "category: description" or just "category"
  const options = categories.map((category) => {
    const description = categoryDescriptions[category];
    if (description) {
      return { name: `${category}: ${description}`, value: category };
    }
    return { name: category, value: category };
  });

  // Prompt user to select
  const selected = await select({
    message: "Select template:",
    choices: options,
  });

  return selected;
}

/**
 * Populate project from template
 */
async function populateProjectFromTemplate(
  cfg: ProjectConfig,
  options: CreateAppOpts,
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

/**
 * Prompt for project name
 */
async function promptProjectName(): Promise<string> {
  return input({ message: "Enter project name:" });
}

/**
 * Prompt for language selection
 */
async function promptLanguage(): Promise<string> {
  return select({
    message: "Select language:",
    choices: PRIMARY_LANGUAGES,
  });
}
