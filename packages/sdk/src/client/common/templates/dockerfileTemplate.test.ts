import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import { describe, expect, it } from "vitest";

// Same approach as scriptTemplate.test.ts: read the .tmpl directly
// rather than importing it through dockerfileTemplate.ts, since
// vitest's vite-based transform doesn't handle .tmpl files and the
// test is about the rendered body, not the loader.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templatePath = path.join(__dirname, "Dockerfile.layered.tmpl");
const template = fs.readFileSync(templatePath, "utf-8");

type Data = {
  baseImage: string;
  originalCmd: string;
  originalUser: string;
  logRedirect: string;
  resourceUsageAllow: string;
  includeTLS: boolean;
  ecloudCLIVersion: string;
};

function render(data: Data): string {
  return Handlebars.compile(template)(data);
}

describe("Dockerfile.layered.tmpl", () => {
  const base: Data = {
    baseImage: "node:25-bookworm-slim",
    originalCmd: '["npm", "start"]',
    originalUser: "",
    logRedirect: "always",
    resourceUsageAllow: "always",
    includeTLS: false,
    ecloudCLIVersion: "0.0.0-test",
  };

  it("emits the tee.launch_policy.allow_env_override label for ECLOUD_PD_EXPECTED", () => {
    // Regression guard for the 2026-05-04 dev incident where the
    // Confidential Space launcher rejected the orchestrator's
    // `tee-env-ECLOUD_PD_EXPECTED=1` override because this label
    // wasn't set, exiting the VM before the entrypoint ran. Without
    // this label, PD-backed apps can never deploy.
    const rendered = render(base);
    expect(rendered).toContain("LABEL tee.launch_policy.allow_env_override=ECLOUD_PD_EXPECTED");
  });

  it("tags the image with eigenx_vm_image=eigen (needed for platform's image-family selection)", () => {
    const rendered = render(base);
    expect(rendered).toContain("LABEL eigenx_vm_image=eigen");
  });

  it("stamps eigenx_container_contract=v1 for prewarm-detach eligibility gate", () => {
    const rendered = render(base);
    expect(rendered).toContain("LABEL eigenx_container_contract=v1");
  });
});
