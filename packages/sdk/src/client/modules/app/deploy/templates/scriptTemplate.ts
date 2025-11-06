/**
 * Script template processing
 */

import * as fs from 'fs';
import * as path from 'path';
import Handlebars from 'handlebars';
import { ENV_SOURCE_SCRIPT_TEMPLATE_PATH } from '../constants';
import { getDirname } from '../utils/dirname';

const __dirname = getDirname();

export interface ScriptTemplateData {
  KMSServerURL: string;
  JWTFile: string;
  UserAPIURL: string;
}

/**
 * Process script template
 */
export function processScriptTemplate(data: ScriptTemplateData): string {
  // Load template from embedded files or file system
  const templatePath = path.join(
    __dirname,
    '../../templates',
    ENV_SOURCE_SCRIPT_TEMPLATE_PATH
  );

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Script template not found at ${templatePath}`);
  }

  const templateContent = fs.readFileSync(templatePath, 'utf-8');
  const template = Handlebars.compile(templateContent);
  return template(data);
}

