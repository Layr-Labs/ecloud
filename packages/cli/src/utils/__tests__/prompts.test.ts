import { afterEach, describe, expect, it, vi } from "vitest";
import { getEnvironmentInteractive, promptUseVerifiableBuild } from "../prompts";

/**
 * Regression tests for two non-interactive mode bugs introduced in PR #126:
 *
 *   1. `getEnvironmentInteractive("mainnet-alpha")` in a dev build silently
 *      swallowed the real error ("not available in this build type") and
 *      surfaced the generic "Cannot prompt in non-interactive mode" message.
 *   2. `promptUseVerifiableBuild()` had no knowledge of `--force`, so any
 *      image-ref-only `app deploy` / `app upgrade` in non-TTY mode threw
 *      `Cannot confirm "Build from verifiable source?" in non-interactive mode.
 *      Use --force to skip confirmation prompts.` even when --force was set.
 */
describe("prompts non-interactive regressions", () => {
  const origBuildType = process.env.BUILD_TYPE;
  const origIsTTY = process.stdin.isTTY;

  afterEach(() => {
    if (origBuildType === undefined) delete process.env.BUILD_TYPE;
    else process.env.BUILD_TYPE = origBuildType;
    process.stdin.isTTY = origIsTTY;
    vi.restoreAllMocks();
  });

  describe("getEnvironmentInteractive", () => {
    it("returns the environment verbatim when it is valid and available", async () => {
      process.env.BUILD_TYPE = "prod";
      await expect(getEnvironmentInteractive("sepolia")).resolves.toBe("sepolia");
      await expect(getEnvironmentInteractive("mainnet-alpha")).resolves.toBe("mainnet-alpha");
    });

    it("surfaces 'Unknown environment' for an unrecognized value", async () => {
      process.env.BUILD_TYPE = "prod";
      await expect(getEnvironmentInteractive("bogusenv")).rejects.toThrow(
        /Unknown environment: bogusenv/,
      );
    });

    it("surfaces 'not available in this build type' for envs missing from the current build", async () => {
      // Bug 1 scenario: user installed a dev build, then ran a command with
      // --environment mainnet-alpha. Previously they got the misleading
      // "Cannot prompt in non-interactive mode" error. Now they get the
      // real reason, referencing the build type.
      //
      // The SDK bakes BUILD_TYPE in at build time via tsup define, so
      // `process.env.BUILD_TYPE` at runtime cannot flip it back to "dev".
      // Instead, exercise the inverse: in the prod-built SDK used by tests,
      // "sepolia-dev" is the environment that is *not* available — same
      // code path, same error shape.
      process.env.BUILD_TYPE = "prod";
      await expect(getEnvironmentInteractive("sepolia-dev")).rejects.toThrow(
        /not available in this build type/,
      );
    });

    it("falls through to the interactive guard only when no environment is supplied", async () => {
      process.env.BUILD_TYPE = "prod";
      process.stdin.isTTY = false;
      await expect(getEnvironmentInteractive(undefined)).rejects.toThrow(
        /Cannot prompt in non-interactive mode/,
      );
    });
  });

  describe("promptUseVerifiableBuild", () => {
    it("short-circuits to false when force is true, even in non-TTY mode", async () => {
      process.stdin.isTTY = false;
      await expect(promptUseVerifiableBuild(true)).resolves.toBe(false);
    });

    it("throws the 'Use --force' guidance when force is false in non-TTY mode", async () => {
      process.stdin.isTTY = false;
      await expect(promptUseVerifiableBuild(false)).rejects.toThrow(
        /Cannot confirm "Build from verifiable source\?" in non-interactive mode\. Use --force/,
      );
    });

    it("defaults force to false so existing callers still see the non-interactive error", async () => {
      process.stdin.isTTY = false;
      await expect(promptUseVerifiableBuild()).rejects.toThrow(
        /Cannot confirm "Build from verifiable source\?" in non-interactive mode/,
      );
    });
  });
});
