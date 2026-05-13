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
  includeDrainWatcher?: boolean;
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

  it("allow-lists every tee-env-* var ecloud-platform sets on the VM", () => {
    // Regression guard for the same class of CS-launcher
    // env-override rejections that first hit us on 2026-05-04
    // (ECLOUD_PD_EXPECTED) and again on 2026-05-13 with
    // ECLOUD_PLATFORM_HOST. The launcher refuses to start the
    // container when compute.go emits a tee-env-* whose key isn't
    // in this label's comma-separated list. Missing a name here
    // means every fresh deploy silently fails with the VM booting,
    // the container refusing to start, and the platform incorrectly
    // reporting 'Running' because the readiness check is skipped
    // for imported builds.
    const rendered = render(base);
    expect(rendered).toMatch(
      /LABEL tee\.launch_policy\.allow_env_override=([A-Z_,]*\b)ECLOUD_PD_EXPECTED\b/,
    );
    expect(rendered).toMatch(
      /LABEL tee\.launch_policy\.allow_env_override=([A-Z_,]*\b)ECLOUD_PLATFORM_HOST\b/,
    );
  });

  it("tags the image with eigenx_vm_image=eigen (needed for platform's image-family selection)", () => {
    const rendered = render(base);
    expect(rendered).toContain("LABEL eigenx_vm_image=eigen");
  });

  it("stamps eigenx_container_contract=v1 for prewarm-detach eligibility gate", () => {
    const rendered = render(base);
    expect(rendered).toContain("LABEL eigenx_container_contract=v1");
  });

  it("copies the optional ecloud-drain-watcher runtime binary", () => {
    const rendered = render({ ...base, includeDrainWatcher: true });
    expect(rendered).toContain("COPY ecloud-drain-watcher /usr/local/bin/");
    expect(rendered).toContain("/usr/local/bin/ecloud-drain-watcher");
  });

  it("omits ecloud-drain-watcher copy when runtime artifact is unavailable", () => {
    const rendered = render({ ...base, includeDrainWatcher: false });
    expect(rendered).not.toContain("COPY ecloud-drain-watcher /usr/local/bin/");
  });
});
