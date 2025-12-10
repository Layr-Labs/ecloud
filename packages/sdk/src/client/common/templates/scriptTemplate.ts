import Handlebars from "handlebars";
import scriptTemplate from "./compute-source-env.sh.tmpl";

export interface ScriptTemplateData {
  kmsServerURL: string;
  userAPIURL: string;
}

/**
 * Process script template
 */
export function processScriptTemplate(data: ScriptTemplateData): string {
  const template = Handlebars.compile(scriptTemplate);
  return template(data);
}
