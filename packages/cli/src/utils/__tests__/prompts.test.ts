import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import {
  getEnvironmentInteractive,
  promptUseVerifiableBuild,
  getDockerfileInteractive,
  getEnvFileInteractive,
  getLogSettingsInteractive,
  getResourceUsageMonitoringInteractive,
  getInstanceTypeInteractive,
} from "../prompts";

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

/**
 * RND-564 / RND-571: in non-interactive (non-TTY) mode, the optional deploy /
 * upgrade prompts must fall back to a safe default with a warning instead of
 * throwing "Cannot prompt in non-interactive mode". Required inputs that have
 * no safe default (e.g. --instance-type) must still error.
 */
describe("non-interactive flag defaulting (RND-564)", () => {
  const origIsTTY = process.stdin.isTTY;

  afterEach(() => {
    process.stdin.isTTY = origIsTTY;
    vi.restoreAllMocks();
  });

  describe("getEnvFileInteractive", () => {
    it("defaults to no env file in non-TTY mode when none is found", async () => {
      process.stdin.isTTY = false;
      // No explicit path, and no auto-detected .env on disk.
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(getEnvFileInteractive(undefined)).resolves.toBe("");
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/--env-file.*no env file/));
    });

    it("still returns an explicitly provided, existing env file in non-TTY mode", async () => {
      process.stdin.isTTY = false;
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "custom.env");
      await expect(getEnvFileInteractive("custom.env")).resolves.toBe("custom.env");
    });
  });

  describe("getLogSettingsInteractive", () => {
    it("defaults to private logs in non-TTY mode", async () => {
      process.stdin.isTTY = false;
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(getLogSettingsInteractive(undefined)).resolves.toEqual({
        logRedirect: "always",
        publicLogs: false,
      });
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/--log-visibility.*private/));
    });

    it("never silently defaults to public in non-TTY mode", async () => {
      process.stdin.isTTY = false;
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const settings = await getLogSettingsInteractive(undefined);
      expect(settings.publicLogs).toBe(false);
    });

    it("honors an explicit --log-visibility value regardless of TTY", async () => {
      process.stdin.isTTY = false;
      await expect(getLogSettingsInteractive("public")).resolves.toEqual({
        logRedirect: "always",
        publicLogs: true,
      });
    });
  });

  describe("getResourceUsageMonitoringInteractive", () => {
    it("defaults to disable in non-TTY mode", async () => {
      process.stdin.isTTY = false;
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(getResourceUsageMonitoringInteractive(undefined)).resolves.toBe("disable");
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/--resource-usage-monitoring.*disable/),
      );
    });

    it("honors an explicit value regardless of TTY", async () => {
      process.stdin.isTTY = false;
      await expect(getResourceUsageMonitoringInteractive("enable")).resolves.toBe("enable");
    });
  });

  describe("getDockerfileInteractive", () => {
    it("returns '' (deploy existing image) when no Dockerfile exists, even in non-TTY mode", async () => {
      process.stdin.isTTY = false;
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      await expect(getDockerfileInteractive(undefined)).resolves.toBe("");
    });

    it("defaults to building the discovered Dockerfile in non-TTY mode", async () => {
      process.stdin.isTTY = false;
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await getDockerfileInteractive(undefined);
      expect(result).toMatch(/Dockerfile$/);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/--dockerfile.*build from/));
    });

    it("returns an explicitly provided Dockerfile path verbatim", async () => {
      process.stdin.isTTY = false;
      await expect(getDockerfileInteractive("./custom/Dockerfile")).resolves.toBe(
        "./custom/Dockerfile",
      );
    });
  });

  describe("getInstanceTypeInteractive", () => {
    const types = [
      { sku: "g1-standard-2s", friendly_name: "Standard 2s", description: "2 vCPU, SEV-SNP" },
      { sku: "g1-standard-4t", friendly_name: "Standard 4t", description: "4 vCPU, TDX" },
    ];

    it("still errors in non-TTY mode when no instance type is provided (no safe default)", async () => {
      process.stdin.isTTY = false;
      await expect(getInstanceTypeInteractive(undefined, "", types)).rejects.toThrow(
        /Cannot prompt in non-interactive mode.*--instance-type/,
      );
    });

    it("returns an explicitly provided, valid instance type in non-TTY mode", async () => {
      process.stdin.isTTY = false;
      await expect(getInstanceTypeInteractive("g1-standard-2s", "", types)).resolves.toBe(
        "g1-standard-2s",
      );
    });
  });
});
