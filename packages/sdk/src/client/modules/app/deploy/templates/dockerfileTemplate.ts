import * as fs from 'fs';
import * as path from 'path';
import Handlebars from 'handlebars';
import { LAYERED_DOCKERFILE_TEMPLATE_PATH } from '../constants';
import { getDirname } from '../utils/dirname';

const __dirname = getDirname();

export interface DockerfileTemplateData {
  baseImage: string;
  originalCmd: string; // JSON array string
  originalUser: string;
  logRedirect: string;
  includeTLS: boolean;
  ecloudCLIVersion: string;
}

/**
 * Process Dockerfile template
 */
export function processDockerfileTemplate(
  data: DockerfileTemplateData
): string {
  // TODO: Load template from embedded files or file system
  // For now, return a basic template
  const templatePath = path.join(
    __dirname,
    '../../templates',
    LAYERED_DOCKERFILE_TEMPLATE_PATH
  );

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Dockerfile template not found at ${templatePath}`);
  }

  const templateContent = fs.readFileSync(templatePath, 'utf-8');
  const template = Handlebars.compile(templateContent);
  return template(data);
}

