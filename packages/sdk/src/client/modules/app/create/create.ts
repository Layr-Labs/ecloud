/**
 * Create command
 *
 * Creates a new app project from a template
 */

import * as fs from "fs";
import * as path from "path";
import { Logger } from "../../../common/types";
import { defaultLogger } from "../../../common/utils";
import { loadTemplateConfig, getTemplateURLs } from "./template/config";
import { fetchTemplate, fetchTemplateSubdirectory } from "./template/git";
import { postProcessTemplate } from "./template/postprocess";
import { input, select } from "@inquirer/prompts";

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
 * Create a new app project from template
 */
export async function createApp(
  options: CreateAppOpts,
  logger: Logger = defaultLogger,
): Promise<void> {
  // 1. Get project name
  let name = options.name;
  if (!name) {
    name = await promptProjectName();
  }

  // Validate project name
  validateProjectName(name);

  // Check if directory exists
  if (fs.existsSync(name)) {
    throw new Error(`Directory ${name} already exists`);
  }

  // 2. Get language - only needed for built-in templates
  let language: string | undefined;
  if (!options.template) {
    language = options.language;
    if (!language) {
      language = await promptLanguage();
    } else {
      // Resolve short names to full names
      if (SHORT_NAMES[language]) {
        language = SHORT_NAMES[language];
      }

      // Validate language is supported
      if (!PRIMARY_LANGUAGES.includes(language)) {
        throw new Error(`Unsupported language: ${language}`);
      }
    }
  }

  // 3. Resolve template source
  const { repoURL, ref, subPath } = await resolveTemplateSource(
    options.template,
    options.templateVersion,
    language,
  );

  // 4. Create project directory
  fs.mkdirSync(name, { mode: 0o755 });

  try {
    // 5. Check if we should use local templates (for development)
    const useLocalTemplates = process.env.EIGENX_USE_LOCAL_TEMPLATES === "true";
    if (useLocalTemplates) {
      await useLocalTemplate(name, language!, logger);
    } else {
      // 6. Fetch template from Git
      if (subPath) {
        // Fetch only the subdirectory
        await fetchTemplateSubdirectory(repoURL, ref, subPath, name, logger);
      } else {
        // Fetch the full repository
        await fetchTemplate(
          repoURL,
          ref,
          name,
          { verbose: options.verbose || false },
          logger,
        );
      }
    }

    // 7. Post-process only internal templates
    if (subPath && language) {
      await postProcessTemplate(name, language, logger);
    }

    logger.info(`Successfully created ${language || "project"}: ${name}`);
  } catch (error: any) {
    // Cleanup on failure
    fs.rmSync(name, { recursive: true, force: true });
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
 * Resolve template source (URL, ref, subdirectory path)
 */
async function resolveTemplateSource(
  templateFlag?: string,
  templateVersionFlag?: string,
  language?: string,
): Promise<{ repoURL: string; ref: string; subPath: string }> {
  if (templateFlag) {
    // Custom template URL provided
    const ref = templateVersionFlag || "main";
    return { repoURL: templateFlag, ref, subPath: "" };
  }

  // Use template configuration system for defaults
  const config = await loadTemplateConfig();
  if (!language) {
    throw new Error("Language is required for default templates");
  }

  // Get template URL and version from config for "tee" framework
  const { templateURL, version } = getTemplateURLs(config, "tee", language);

  // Override version if templateVersionFlag provided
  const ref = templateVersionFlag || version;

  // For templates from config, assume they follow our subdirectory structure
  const subPath = `templates/minimal/${language}`;

  return { repoURL: templateURL, ref, subPath };
}

/**
 * Use local template (for development)
 */
async function useLocalTemplate(
  projectDir: string,
  language: string,
  logger: Logger,
): Promise<void> {
  // First try EIGENX_TEMPLATES_PATH env var, then look for the eigenx-templates directory as a sibling directory
  let eigenxTemplatesPath = process.env.EIGENX_TEMPLATES_PATH;

  if (!eigenxTemplatesPath) {
    // Look for eigenx-templates as a sibling directory
    const possiblePaths = ["eigenx-templates", "../eigenx-templates"];
    for (const possiblePath of possiblePaths) {
      const testPath = path.join(possiblePath, "templates/minimal");
      if (fs.existsSync(testPath)) {
        eigenxTemplatesPath = possiblePath;
        break;
      }
    }

    if (!eigenxTemplatesPath) {
      throw new Error(
        "Cannot find eigenx-templates directory. Set EIGENX_TEMPLATES_PATH or ensure eigenx-templates is a sibling directory",
      );
    }
  }

  // Use local templates from the eigenx-templates repository
  const localTemplatePath = path.join(
    eigenxTemplatesPath,
    "templates/minimal",
    language,
  );

  if (!fs.existsSync(localTemplatePath)) {
    throw new Error(`Local template not found at ${localTemplatePath}`);
  }

  // Copy local template to project directory
  await copyDirectory(localTemplatePath, projectDir);
  logger.info(`Using local template from ${localTemplatePath}`);
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
    message: "Select a language",
    choices: PRIMARY_LANGUAGES,
  });
}
