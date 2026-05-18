import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import { describe, expect, it } from "vitest";

// Read the template directly rather than importing it through
// scriptTemplate.ts. The .tmpl import works at build time via tsup
// (which treats unknown extensions as string assets) but vitest's
// vite-based transform pipeline chokes on .tmpl without extra
// asset-loader plumbing. Since the point of the test is to verify
// the rendered template body, not the loader, reading the file
// directly keeps the test infrastructure out of scope.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templatePath = path.join(__dirname, "compute-source-env.sh.tmpl");
const template = fs.readFileSync(templatePath, "utf-8");

function render(data: { kmsServerURL: string; userAPIURL: string }): string {
  return Handlebars.compile(template)(data);
}

describe("compute-source-env.sh.tmpl", () => {
  const data = {
    kmsServerURL: "http://kms.example.com:8080",
    userAPIURL: "https://api.example.com",
  };

  it("substitutes Handlebars placeholders end-to-end", () => {
    const rendered = render(data);
    expect(rendered).toContain('--kms-server-url "http://kms.example.com:8080"');
    expect(rendered).toContain('--userapi-url "https://api.example.com"');
    expect(rendered).toContain('export KMS_SERVER_URL="http://kms.example.com:8080"');
    expect(rendered).toContain('API_URL="https://api.example.com"');
    // No dangling {{ }} left after rendering.
    expect(rendered).not.toMatch(/\{\{[^}]/);
  });

  it("emits ECLOUD lifecycle markers that ecloud-platform's serial-console watcher needs", () => {
    // Regression guard for the 2026-05-04 dev incident where an older
    // template shipped without these markers caused every deploy to
    // time out at waitForStartupReady and the platform to delete the
    // VM. Keep all four present; the platform watches for ECLOUD_READY
    // (success path) and ECLOUD_FAIL (any exit-1 setup failure),
    // ECLOUD_AWAITING_USERDATA (prewarm-detach old VM), and
    // ECLOUD_DETACHED (prewarm-detach drained old VM).
    const rendered = render(data);
    expect(rendered).toContain("ECLOUD_READY runtime_bootstrapped");
    expect(rendered).toContain("ECLOUD_FAIL kms_bootstrap");
    expect(rendered).toContain("ECLOUD_AWAITING_USERDATA");
    expect(rendered).toContain("ECLOUD_DETACHED");
  });

  it("reads the KMS signing public key from the file the CLI lays into the image", () => {
    // The image layering step copies the key material to
    // /usr/local/bin/kms-signing-public-key.pem; the script must read
    // from there. This is the CLI-specific divergence from the
    // platform's template (which heredoc-embeds the key).
    const rendered = render(data);
    expect(rendered).toContain("--kms-signing-key-file /usr/local/bin/kms-signing-public-key.pem");
    expect(rendered).toContain("cat /usr/local/bin/kms-signing-public-key.pem");
  });

  it("installs the PD wait + drain-watcher machinery for prewarm-detach apps", () => {
    const rendered = render(data);
    expect(rendered).toContain("wait_for_userdata");
    expect(rendered).toContain("drain_handler");
    expect(rendered).toContain("drain_watcher");
    expect(rendered).toContain("/usr/local/bin/ecloud-drain-watcher");
    expect(rendered).toContain("ECLOUD_PD_EXPECTED");
    expect(rendered).toContain("ECLOUD_DRAIN_REQUESTED");
  });

  it("backfills the dormant TLS site's cert paths so caddy validate passes", () => {
    // Caddyfile.default.tmpl declares two `tls` directives, one per
    // site block. When only one host is configured, the other block's
    // cert files don't exist, and `caddy validate` fails on missing
    // file paths — the original tls_invalid_caddyfile bug. The script
    // must symlink the issued cert into the unused dir before
    // validate runs.
    const rendered = render(data);
    expect(rendered).toContain("ln -sf /run/tls/platform/fullchain.pem /run/tls/domain/fullchain.pem");
    expect(rendered).toContain("ln -sf /run/tls/platform/privkey.pem /run/tls/domain/privkey.pem");
    expect(rendered).toContain("ln -sf /run/tls/domain/fullchain.pem /run/tls/platform/fullchain.pem");
    expect(rendered).toContain("ln -sf /run/tls/domain/privkey.pem /run/tls/platform/privkey.pem");
  });

  it("lets caddy validate's stderr ride the launcher's stdout so the diagnostic lands in serial tail", () => {
    // The platform's serial-console watcher captures stdout/stderr
    // into ReadinessError.SerialTail. Silencing caddy validate with
    // 2>/dev/null hides the actual config error and leaves operators
    // with only "tls_invalid_caddyfile" to debug.
    const rendered = render(data);
    expect(rendered).not.toMatch(/caddy validate[^\n]*2>\/dev\/null/);
    expect(rendered).toMatch(/caddy validate --config \/etc\/caddy\/Caddyfile --adapter caddyfile;/);
  });
});
