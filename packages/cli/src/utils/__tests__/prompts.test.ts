import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";

// Any helper that falls through to an interactive prompt is a bug in these
// tests' scenarios (we always run with a non-interactive intent). Make that
// fail loudly and deterministically instead of hanging on real stdin.
vi.mock("@inquirer/prompts", () => ({
  select: vi.fn(async () => {
    throw new Error("unexpected interactive select()");
  }),
  input: vi.fn(async () => {
    throw new Error("unexpected interactive input()");
  }),
  password: vi.fn(async () => {
    throw new Error("unexpected interactive password()");
  }),
  confirm: vi.fn(async () => {
    throw new Error("unexpected interactive confirm()");
  }),
}));

import {
  getEnvironmentInteractive,
  promptUseVerifiableBuild,
  getDockerfile,
  getEnvFile,
  getLogSettings,
  getResourceUsageMonitoring,
  getInstanceType,
  isNonInteractive,
  collectMissingRequiredInputs,
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

    // confirmWithDefault returns the default in non-TTY mode instead of
    // throwing, so a verifiable-build confirm resolves to false (regular
    // build) rather than erroring. Optional confirms never block a
    // non-interactive run.
    it("resolves to false (regular build) when force is false in non-TTY mode", async () => {
      process.stdin.isTTY = false;
      await expect(promptUseVerifiableBuild(false)).resolves.toBe(false);
    });

    it("defaults force to false and still resolves to false in non-TTY mode", async () => {
      process.stdin.isTTY = false;
      await expect(promptUseVerifiableBuild()).resolves.toBe(false);
    });
  });
});

/**
 * In non-interactive (non-TTY) mode, the optional deploy / upgrade prompts
 * must fall back to a safe default with a warning instead of
 * throwing "Cannot prompt in non-interactive mode". Required inputs that have
 * no safe default (e.g. --instance-type) must still error.
 */
describe("non-interactive flag defaulting", () => {
  const origIsTTY = process.stdin.isTTY;

  afterEach(() => {
    process.stdin.isTTY = origIsTTY;
    vi.restoreAllMocks();
  });

  describe("getEnvFile", () => {
    it("defaults to no env file in non-TTY mode when none is found", async () => {
      process.stdin.isTTY = false;
      // No explicit path, and no auto-detected .env on disk.
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(getEnvFile(undefined, true)).resolves.toBe("");
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/--env-file.*no env file/));
    });

    it("still returns an explicitly provided, existing env file in non-TTY mode", async () => {
      process.stdin.isTTY = false;
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "custom.env");
      await expect(getEnvFile("custom.env")).resolves.toBe("custom.env");
    });
  });

  describe("getLogSettings", () => {
    it("defaults to private logs in non-TTY mode", async () => {
      process.stdin.isTTY = false;
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(getLogSettings(undefined, true)).resolves.toEqual({
        logRedirect: "always",
        publicLogs: false,
      });
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/--log-visibility.*private/));
    });

    it("never silently defaults to public in non-TTY mode", async () => {
      process.stdin.isTTY = false;
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const settings = await getLogSettings(undefined, true);
      expect(settings.publicLogs).toBe(false);
    });

    it("honors an explicit --log-visibility value regardless of TTY", async () => {
      process.stdin.isTTY = false;
      await expect(getLogSettings("public")).resolves.toEqual({
        logRedirect: "always",
        publicLogs: true,
      });
    });
  });

  describe("getResourceUsageMonitoring", () => {
    it("defaults to disable in non-TTY mode", async () => {
      process.stdin.isTTY = false;
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(getResourceUsageMonitoring(undefined, true)).resolves.toBe("disable");
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/--resource-usage-monitoring.*disable/),
      );
    });

    it("honors an explicit value regardless of TTY", async () => {
      process.stdin.isTTY = false;
      await expect(getResourceUsageMonitoring("enable")).resolves.toBe("enable");
    });
  });

  describe("getDockerfile", () => {
    it("returns '' (deploy existing image) when no Dockerfile exists, even in non-TTY mode", async () => {
      process.stdin.isTTY = false;
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      await expect(getDockerfile(undefined)).resolves.toBe("");
    });

    it("defaults to building the discovered Dockerfile in non-TTY mode", async () => {
      process.stdin.isTTY = false;
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await getDockerfile(undefined, true);
      expect(result).toMatch(/Dockerfile$/);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/--dockerfile.*build from/));
    });

    it("returns an explicitly provided Dockerfile path verbatim", async () => {
      process.stdin.isTTY = false;
      await expect(getDockerfile("./custom/Dockerfile")).resolves.toBe("./custom/Dockerfile");
    });
  });

  describe("getInstanceType", () => {
    const types = [
      { sku: "g1-standard-2s", friendly_name: "Standard 2s", description: "2 vCPU, SEV-SNP" },
      { sku: "g1-standard-4t", friendly_name: "Standard 4t", description: "4 vCPU, TDX" },
    ];

    it("returns an explicitly provided, valid instance type in non-TTY mode", async () => {
      process.stdin.isTTY = false;
      await expect(getInstanceType("g1-standard-2s", "", types)).resolves.toBe("g1-standard-2s");
    });

    // Deploy with no instance type defaults to g1-standard-2s in non-interactive mode.
    it("defaults to g1-standard-2s in non-interactive deploy when available", async () => {
      process.stdin.isTTY = false;
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await expect(getInstanceType(undefined, "", types, true)).resolves.toBe("g1-standard-2s");
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/--instance-type.*g1-standard-2s/));
    });

    // Upgrade reuses the currently pinned type (defaultSKU) instead of prompting.
    it("reuses defaultSKU (pinned type) in non-interactive upgrade", async () => {
      process.stdin.isTTY = false;
      vi.spyOn(console, "warn").mockImplementation(() => {});
      await expect(getInstanceType(undefined, "g1-standard-4t", types, true)).resolves.toBe(
        "g1-standard-4t",
      );
    });

    it("errors in non-interactive when the default SKU is not offered", async () => {
      process.stdin.isTTY = false;
      await expect(
        getInstanceType(
          undefined,
          "",
          [{ sku: "g1-micro-1v", friendly_name: "m", description: "" }],
          true,
        ),
      ).rejects.toThrow(/instance-type/);
    });
  });
});

/**
 * The optional-input helpers must honor an injected non-interactive decision,
 * not re-derive it from process.stdin/CI internally. This is what lets
 * `--non-interactive` work on a real TTY (where isTTY is true and CI is unset):
 * the command resolves isNonInteractive(flags) once and threads the boolean
 * down. Each test below runs on a TTY with CI unset — so a helper that ignores
 * the injected flag would fall through to a (mocked, throwing) prompt.
 */
describe("optional-input helpers honor injected nonInteractive on a TTY", () => {
  const origIsTTY = process.stdin.isTTY;
  const origCI = process.env.CI;

  beforeEach(() => {
    process.stdin.isTTY = true;
    delete process.env.CI;
  });
  afterEach(() => {
    process.stdin.isTTY = origIsTTY;
    if (origCI === undefined) delete process.env.CI;
    else process.env.CI = origCI;
    vi.restoreAllMocks();
  });

  it("getEnvFile defaults to no env file", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(getEnvFile(undefined, true)).resolves.toBe("");
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/--env-file.*no env file/));
  });

  it("getLogSettings defaults to private logs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(getLogSettings(undefined, true)).resolves.toEqual({
      logRedirect: "always",
      publicLogs: false,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/--log-visibility.*private/));
  });

  it("getResourceUsageMonitoring defaults to disable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(getResourceUsageMonitoring(undefined, true)).resolves.toBe("disable");
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/--resource-usage-monitoring.*disable/),
    );
  });

  it("getDockerfile defaults to building the discovered Dockerfile", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await getDockerfile(undefined, true);
    expect(result).toMatch(/Dockerfile$/);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/--dockerfile.*build from/));
  });

  it("the same helpers still prompt on a TTY when nonInteractive is false", async () => {
    // Sanity: when the injected decision is interactive, the helper reaches the
    // (mocked) prompt rather than silently defaulting. Proves the boolean is
    // actually driving the branch, not being ignored.
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    await expect(getLogSettings(undefined, false)).rejects.toThrow(/unexpected interactive/);
  });
});

describe("isNonInteractive detection", () => {
  const origTTY = process.stdin.isTTY;
  const origCI = process.env.CI;
  afterEach(() => {
    process.stdin.isTTY = origTTY;
    if (origCI === undefined) delete process.env.CI;
    else process.env.CI = origCI;
  });

  it("true when --non-interactive flag is set, even on a TTY", () => {
    process.stdin.isTTY = true;
    delete process.env.CI;
    expect(isNonInteractive({ "non-interactive": true })).toBe(true);
  });
  it("true when CI=true, even on a TTY", () => {
    process.stdin.isTTY = true;
    process.env.CI = "true";
    expect(isNonInteractive()).toBe(true);
  });
  it("true when no TTY", () => {
    process.stdin.isTTY = false;
    delete process.env.CI;
    expect(isNonInteractive()).toBe(true);
  });
  it("false on a TTY with no CI and no flag", () => {
    process.stdin.isTTY = true;
    delete process.env.CI;
    expect(isNonInteractive()).toBe(false);
  });
});

describe("collectMissingRequiredInputs reports all missing at once", () => {
  it("returns [] when image source + name present", () => {
    expect(collectMissingRequiredInputs({ imageRef: "r", name: "n" }, "name")).toEqual([]);
  });
  it("lists both missing image source and name", () => {
    const m = collectMissingRequiredInputs({ verifiable: false }, "name");
    expect(m.join(" ")).toMatch(/image source/);
    expect(m.join(" ")).toMatch(/--name/);
  });
  it("accepts verifiable git source as image source", () => {
    const m = collectMissingRequiredInputs(
      { verifiable: true, repo: "x", commit: "y", name: "n" },
      "name",
    );
    expect(m).toEqual([]);
  });
  it("reports only the image source for upgrade (app-id handled at call site)", () => {
    const m = collectMissingRequiredInputs({}, "app-id");
    expect(m).toEqual([expect.stringMatching(/image source/)]);
  });
});
