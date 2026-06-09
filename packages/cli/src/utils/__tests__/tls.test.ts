import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  isTlsEnabledFromEnvFile,
  isTlsEnabledFromDomain,
  TLS_DISABLED_WARNING,
  TLS_INFO_LINE,
} from "../tls";

describe("isTlsEnabledFromDomain", () => {
  it("is false for empty/undefined/localhost, true otherwise", () => {
    expect(isTlsEnabledFromDomain(undefined)).toBe(false);
    expect(isTlsEnabledFromDomain("")).toBe(false);
    expect(isTlsEnabledFromDomain("  ")).toBe(false);
    expect(isTlsEnabledFromDomain("localhost")).toBe(false);
    expect(isTlsEnabledFromDomain("LocalHost")).toBe(false);
    expect(isTlsEnabledFromDomain("app.example.com")).toBe(true);
  });
});

describe("isTlsEnabledFromEnvFile", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tls-test-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns false when no path is given", () => {
    expect(isTlsEnabledFromEnvFile(undefined)).toBe(false);
  });

  it("returns false when the file does not exist", () => {
    expect(isTlsEnabledFromEnvFile(path.join(dir, "nope.env"))).toBe(false);
  });

  it("returns false when DOMAIN is absent", () => {
    const p = path.join(dir, "a.env");
    fs.writeFileSync(p, "FOO=bar\nBAZ=qux\n");
    expect(isTlsEnabledFromEnvFile(p)).toBe(false);
  });

  it("returns false when DOMAIN is localhost", () => {
    const p = path.join(dir, "b.env");
    fs.writeFileSync(p, "DOMAIN=localhost\n");
    expect(isTlsEnabledFromEnvFile(p)).toBe(false);
  });

  it("returns true when DOMAIN is a real host", () => {
    const p = path.join(dir, "c.env");
    fs.writeFileSync(p, "FOO=bar\nDOMAIN=app.example.com\n");
    expect(isTlsEnabledFromEnvFile(p)).toBe(true);
  });
});

describe("TLS user-facing strings", () => {
  it("both reference the configure tls remediation command", () => {
    expect(TLS_DISABLED_WARNING).toContain("configure tls");
    expect(TLS_INFO_LINE).toContain("configure tls");
  });
  it("the disabled warning mentions DOMAIN and the ports", () => {
    expect(TLS_DISABLED_WARNING).toContain("DOMAIN");
    expect(TLS_DISABLED_WARNING).toContain("80/443");
  });
});
