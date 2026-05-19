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
    // VM. The script owns ECLOUD_READY (success path) and ECLOUD_FAIL
    // (any exit-1 setup failure).
    //
    // The PD lifecycle markers (AWAITING_USERDATA, DETACHED) are
    // emitted by the cos-tdx launcher (Layr-Labs/go-tpm-tools) and
    // intentionally NOT by this script — the script lacks
    // CAP_SYS_ADMIN to mount/umount and the launcher is the only
    // place that work can succeed. A regression of either marker
    // emit returning to this script indicates someone re-introduced
    // the script-side LUKS approach that already failed in production
    // once. We detect emission by looking at echo statements only,
    // since the marker names appear (correctly) in header comments
    // explaining the launcher's role.
    const rendered = render(data);
    expect(rendered).toContain("ECLOUD_READY runtime_bootstrapped");
    expect(rendered).toContain("ECLOUD_FAIL kms_bootstrap");
    expect(rendered).not.toMatch(/^\s*echo\s+["']?ECLOUD_AWAITING_USERDATA/m);
    expect(rendered).not.toMatch(/^\s*echo\s+["']?ECLOUD_DETACHED/m);
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

  it("installs the drain-watcher + SIGTERM forwarder for prewarm-detach apps", () => {
    // After the Option A migration, the script no longer owns the PD
    // lifecycle (mount/umount/cryptsetup) — the cos-tdx launcher does.
    // What the script DOES own is forwarding SIGTERM to the user app
    // for graceful shutdown, gated on ECLOUD_PD_EXPECTED so non-PD apps
    // skip the metadata-poll fallback.
    const rendered = render(data);
    expect(rendered).toContain("drain_handler");
    expect(rendered).toContain("drain_watcher");
    expect(rendered).toContain("/usr/local/bin/ecloud-drain-watcher");
    expect(rendered).toContain("ECLOUD_PD_EXPECTED");
    expect(rendered).toContain("ECLOUD_DRAIN_REQUESTED");
  });

  it("does NOT do PD mount/umount work itself (launcher owns that)", () => {
    // Regression guard against re-introducing the script-side LUKS
    // approach. The user container has no CAP_SYS_ADMIN by default, so
    // any mount/umount/cryptsetup invocation here silently EPERMs in
    // production and the user's data ends up on the boot-disk
    // stateful partition (wiped on every reboot). See
    // ecloud-platform docs/solutions/2026-05-15-prewarm-detach-pd-preservation-boot-race.md
    // for the full incident. We match against non-comment lines so a
    // future doc comment about the launcher's responsibilities (which
    // legitimately names mount/umount/cryptsetup as launcher-side
    // primitives) doesn't trip the guard.
    const nonComment = render(data)
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    expect(nonComment).not.toContain("wait_for_userdata");
    expect(nonComment).not.toMatch(/(?:^|[;&|\s])mount\s+/m);
    expect(nonComment).not.toMatch(/(?:^|[;&|\s])umount\s+/m);
    expect(nonComment).not.toContain("mkfs.ext4");
    expect(nonComment).not.toContain("cryptsetup");
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
