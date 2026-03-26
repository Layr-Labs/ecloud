import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { mergeInlineEnvVars } from "../env";

describe("mergeInlineEnvVars", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "env-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns original path when no inline vars provided", () => {
    const envFile = path.join(tmpDir, ".env");
    fs.writeFileSync(envFile, "FOO=bar\n");
    expect(mergeInlineEnvVars(envFile, [])).toBe(envFile);
  });

  it("creates a temp file with inline vars when no env file exists", () => {
    const result = mergeInlineEnvVars("", ["FOO=bar", "BAZ=qux"]);
    const content = fs.readFileSync(result, "utf-8");
    expect(content).toContain("FOO=bar");
    expect(content).toContain("BAZ=qux");
  });

  it("merges inline vars with existing env file", () => {
    const envFile = path.join(tmpDir, ".env");
    fs.writeFileSync(envFile, "EXISTING=value\nOTHER=stuff\n");
    const result = mergeInlineEnvVars(envFile, ["NEW=added"]);
    const content = fs.readFileSync(result, "utf-8");
    expect(content).toContain("EXISTING=value");
    expect(content).toContain("OTHER=stuff");
    expect(content).toContain("NEW=added");
  });

  it("inline vars override env file vars with same key", () => {
    const envFile = path.join(tmpDir, ".env");
    fs.writeFileSync(envFile, "FOO=old\nKEEP=me\n");
    const result = mergeInlineEnvVars(envFile, ["FOO=new"]);
    const content = fs.readFileSync(result, "utf-8");
    expect(content).not.toContain("FOO=old");
    expect(content).toContain("FOO=new");
    expect(content).toContain("KEEP=me");
  });

  it("preserves comments and blank lines from env file", () => {
    const envFile = path.join(tmpDir, ".env");
    fs.writeFileSync(envFile, "# This is a comment\n\nFOO=bar\n");
    const result = mergeInlineEnvVars(envFile, ["BAZ=qux"]);
    const content = fs.readFileSync(result, "utf-8");
    expect(content).toContain("# This is a comment");
    expect(content).toContain("FOO=bar");
    expect(content).toContain("BAZ=qux");
  });

  it("handles values containing equals signs", () => {
    const result = mergeInlineEnvVars("", ["URL=https://example.com?a=1&b=2"]);
    const content = fs.readFileSync(result, "utf-8");
    expect(content).toContain("URL=https://example.com?a=1&b=2");
  });

  it("throws on invalid format (missing =)", () => {
    expect(() => mergeInlineEnvVars("", ["INVALID"])).toThrow(
      'Invalid --env format: "INVALID". Expected KEY=VALUE',
    );
  });

  it("throws on empty key", () => {
    expect(() => mergeInlineEnvVars("", ["=value"])).toThrow(
      'Invalid --env format: "=value". Key cannot be empty',
    );
  });

  it("allows empty value", () => {
    const result = mergeInlineEnvVars("", ["EMPTY="]);
    const content = fs.readFileSync(result, "utf-8");
    expect(content).toContain("EMPTY=");
  });
});
