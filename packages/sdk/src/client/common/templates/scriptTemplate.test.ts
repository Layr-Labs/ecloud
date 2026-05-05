import { describe, expect, it } from "vitest";
import { processScriptTemplate } from "./scriptTemplate";

describe("compute-source-env.sh template", () => {
  const rendered = processScriptTemplate({
    kmsServerURL: "http://test-kms:8080",
    userAPIURL: "http://test-api.example",
  });

  it("renders handlebars placeholders", () => {
    expect(rendered).toContain("http://test-kms:8080");
    expect(rendered).toContain("http://test-api.example");
    expect(rendered).not.toContain("{{kmsServerURL}}");
    expect(rendered).not.toContain("{{userAPIURL}}");
  });

  describe("tls-keygen ACME retry", () => {
    // tls-keygen has no internal retry on transient ACME 5xx. A
    // single "Service busy; retry later" from Let's Encrypt (common
    // on staging) would otherwise terminate the VM. The template
    // wraps the binary invocation in a bounded retry loop — these
    // tests guard the shape of that loop.

    it("caps attempts at a small finite number", () => {
      // Look for `tls_max_attempts=N` and assert N is a sane small
      // value. The exact number is implementation detail, but a
      // regression that unbounded it (or raised it above the
      // per-hour LE failed-auth rate limit of 5 for prod) would be
      // caught here.
      const match = rendered.match(/tls_max_attempts=(\d+)/);
      expect(match, "tls_max_attempts must be set in template").not.toBeNull();
      const n = Number(match![1]);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
    });

    it("retries on failure", () => {
      // A retry loop must both invoke tls-keygen and contain a
      // sleep branch — otherwise it's not really retrying.
      expect(rendered).toMatch(/while\s*\[\s*"\$tls_attempt"/);
      expect(rendered).toMatch(/\/usr\/local\/bin\/tls-keygen/);
      expect(rendered).toMatch(/sleep\s+"\$tls_delay"/);
    });

    it("fails hard after exhausting attempts", () => {
      // On sustained failure the template must still `exit 1` so
      // the Confidential Space launcher sees the same failure
      // signal as before (VM terminates, platform reacts). A retry
      // loop that swallowed the final failure would be worse than
      // no retry at all.
      expect(rendered).toMatch(
        /Failed to obtain TLS certificate after \$tls_max_attempts attempts[\s\S]*?exit 1/,
      );
    });
  });
});
