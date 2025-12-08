/**
 * Template configuration
 *
 * Loads and manages template configuration
 */

import * as fs from "fs";
import * as path from "path";
import { load as loadYaml } from "js-yaml";
import { getDirname } from "../utils/dirname";

const __dirname = getDirname();

export interface TemplateConfig {
  framework: Record<string, FrameworkSpec>;
}

export interface FrameworkSpec {
  template: string;
  version: string;
  languages: string[];
}

/**
 * Load template configuration
 */
export async function loadTemplateConfig(): Promise<TemplateConfig> {
  // Try to load from config directory
  const configPath = path.join(__dirname, "../../config/templates.yaml");

  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, "utf-8");
    return loadYaml(content) as TemplateConfig;
  }

  // Fallback to default config (matches config/templates.yaml)
  return {
    framework: {
      tee: {
        template: "https://github.com/Layr-Labs/eigenx-templates",
        version: "main",
        languages: ["typescript", "golang", "rust", "python"],
      },
    },
  };
}

/**
 * Get template URLs for framework and language
 */
export function getTemplateURLs(
  config: TemplateConfig,
  framework: string,
  language: string,
): { templateURL: string; version: string } {
  const fw = config.framework[framework];
  if (!fw) {
    throw new Error(`Unknown framework: ${framework}`);
  }

  if (!fw.template) {
    throw new Error(`Template URL missing for framework: ${framework}`);
  }

  // Language gate - only enforce if Languages array is populated
  if (fw.languages && fw.languages.length > 0) {
    if (!fw.languages.includes(language)) {
      throw new Error(`Language ${language} not available for framework ${framework}`);
    }
  }

  return {
    templateURL: fw.template,
    version: fw.version,
  };
}
