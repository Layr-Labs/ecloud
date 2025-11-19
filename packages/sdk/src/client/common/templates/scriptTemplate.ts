import * as fs from "fs";
import * as path from "path";
import Handlebars from "handlebars";
import { ENV_SOURCE_SCRIPT_TEMPLATE_PATH } from "../constants";
import { getDirname } from "../utils/dirname";

const __dirname = getDirname();

export interface ScriptTemplateData {
  kmsServerURL: string;
  userAPIURL: string;
}

/**
 * Process script template
 */
export function processScriptTemplate(data: ScriptTemplateData): string {
  // Try multiple paths to support both CLI (bundled) and standalone SDK usage
  const possiblePaths = [
    path.join(__dirname, "./templates", ENV_SOURCE_SCRIPT_TEMPLATE_PATH), // Standalone SDK
    path.join(__dirname, "../../templates", ENV_SOURCE_SCRIPT_TEMPLATE_PATH), // CLI bundled
    path.join(__dirname, "../../../templates", ENV_SOURCE_SCRIPT_TEMPLATE_PATH), // Alternative CLI path
  ];

  let templatePath: string | null = null;
  for (const possiblePath of possiblePaths) {
    if (fs.existsSync(possiblePath)) {
      templatePath = possiblePath;
      break;
    }
  }

  if (!templatePath) {
    throw new Error(
      `Script template not found. Tried: ${possiblePaths.join(", ")}`,
    );
  }

  const templateContent = fs.readFileSync(templatePath, "utf-8");
  const template = Handlebars.compile(templateContent);
  return template(data);
}
