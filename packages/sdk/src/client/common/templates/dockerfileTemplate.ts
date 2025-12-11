import Handlebars from "handlebars";
import dockerfileTemplate from "./Dockerfile.layered.tmpl";

export interface DockerfileTemplateData {
  baseImage: string;
  originalCmd: string; // JSON array string
  originalUser: string;
  logRedirect: string;
  resourceUsageAllow: string; // "always" or "never" for memory monitoring
  includeTLS: boolean;
  ecloudCLIVersion: string;
}

/**
 * Process Dockerfile template
 */
export function processDockerfileTemplate(data: DockerfileTemplateData): string {
  const template = Handlebars.compile(dockerfileTemplate);
  return template(data);
}
