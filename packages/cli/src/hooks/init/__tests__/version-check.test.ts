import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
}));

vi.mock("@layr-labs/ecloud-sdk", () => ({
  getBuildType: vi.fn(() => "prod"),
}));

vi.mock("../../../utils/version", () => ({
  getCliVersion: vi.fn(() => "1.0.0"),
}));

vi.mock("../../../commands/upgrade", () => ({
  upgradePackage: vi.fn(),
}));

vi.mock("../../../utils/globalConfig", () => ({
  loadGlobalConfig: vi.fn(() => ({})),
  saveGlobalConfig: vi.fn(),
}));

import { confirm } from "@inquirer/prompts";
import { getBuildType } from "@layr-labs/ecloud-sdk";
import { getCliVersion } from "../../../utils/version";
import { upgradePackage } from "../../../commands/upgrade";
import { loadGlobalConfig, saveGlobalConfig } from "../../../utils/globalConfig";

// Import the hook - we need to call it manually
import hook from "../version-check";

function createMockContext() {
  return {
    log: vi.fn(),
    exit: vi.fn(),
  };
}

function mockFetch(distTags: Record<string, string> | null, ok = true) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    json: async () => (distTags ? { "dist-tags": distTags } : {}),
  });
}

describe("version-check init hook", () => {
  const origTTY = process.stdin.isTTY;
  const origCI = process.env.CI;

  beforeEach(() => {
    vi.clearAllMocks();
    (getCliVersion as Mock).mockReturnValue("1.0.0");
    (getBuildType as Mock).mockReturnValue("prod");
    (loadGlobalConfig as Mock).mockReturnValue({});
    (saveGlobalConfig as Mock).mockImplementation(() => {});
    // Default to an interactive terminal so the update-prompt path runs.
    process.stdin.isTTY = true;
    delete process.env.CI;
  });

  afterEach(() => {
    process.stdin.isTTY = origTTY;
    if (origCI === undefined) delete process.env.CI;
    else process.env.CI = origCI;
  });

  it("skips check for upgrade command", async () => {
    const ctx = createMockContext();
    await hook.call(ctx as any, { id: "upgrade" } as any);
    expect(ctx.log).not.toHaveBeenCalled();
  });

  it("skips check for version command", async () => {
    const ctx = createMockContext();
    await hook.call(ctx as any, { id: "version" } as any);
    expect(ctx.log).not.toHaveBeenCalled();
  });

  it("skips check for development builds", async () => {
    (getCliVersion as Mock).mockReturnValue("0.0.0");
    const ctx = createMockContext();
    await hook.call(ctx as any, { id: "auth:login" } as any);
    expect(ctx.log).not.toHaveBeenCalled();
  });

  it("does nothing when version is up to date", async () => {
    mockFetch({ latest: "1.0.0" });
    const ctx = createMockContext();
    await hook.call(ctx as any, { id: "auth:login" } as any);
    expect(ctx.log).not.toHaveBeenCalled();
  });

  it("does nothing when fetch fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network error"));
    const ctx = createMockContext();
    await hook.call(ctx as any, { id: "auth:login" } as any);
    expect(ctx.log).not.toHaveBeenCalled();
  });

  it("prompts user when new version is available", async () => {
    mockFetch({ latest: "2.0.0" });
    (confirm as Mock).mockResolvedValue(false);
    const ctx = createMockContext();

    await hook.call(ctx as any, { id: "auth:login" } as any);

    expect(ctx.log).toHaveBeenCalled();
    expect(confirm).toHaveBeenCalled();
    expect(upgradePackage).not.toHaveBeenCalled();
  });

  // In non-interactive mode the hook must not block on the update
  // prompt (it ran before the command and read as a failure in CI/agents).
  it("does not prompt in non-interactive mode (no TTY)", async () => {
    process.stdin.isTTY = false;
    mockFetch({ latest: "2.0.0" });
    const ctx = createMockContext();

    await hook.call(ctx as any, { id: "auth:login" } as any);

    expect(confirm).not.toHaveBeenCalled();
    expect(upgradePackage).not.toHaveBeenCalled();
  });

  it("does not prompt when CI=true even on a TTY", async () => {
    process.stdin.isTTY = true;
    process.env.CI = "true";
    mockFetch({ latest: "2.0.0" });
    const ctx = createMockContext();

    await hook.call(ctx as any, { id: "auth:login" } as any);

    expect(confirm).not.toHaveBeenCalled();
  });

  it("upgrades when user confirms", async () => {
    mockFetch({ latest: "2.0.0" });
    (confirm as Mock).mockResolvedValue(true);
    const ctx = createMockContext();

    await hook.call(ctx as any, { id: "auth:login" } as any);

    expect(upgradePackage).toHaveBeenCalledWith(undefined, "latest");
    expect(ctx.exit).toHaveBeenCalledWith(0);
  });

  it("uses dev dist-tag for dev builds", async () => {
    (getBuildType as Mock).mockReturnValue("dev");
    mockFetch({ dev: "2.0.0-dev.1" });
    (confirm as Mock).mockResolvedValue(true);
    const ctx = createMockContext();

    await hook.call(ctx as any, { id: "auth:login" } as any);

    expect(upgradePackage).toHaveBeenCalledWith(undefined, "dev");
  });

  it("continues if upgrade fails", async () => {
    mockFetch({ latest: "2.0.0" });
    (confirm as Mock).mockResolvedValue(true);
    (upgradePackage as Mock).mockImplementation(() => {
      throw new Error("upgrade failed");
    });
    const ctx = createMockContext();

    await hook.call(ctx as any, { id: "auth:login" } as any);

    expect(ctx.exit).not.toHaveBeenCalled();
    expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining("Upgrade failed"));
  });

  it("detects newer major version", async () => {
    mockFetch({ latest: "2.0.0" });
    (confirm as Mock).mockResolvedValue(false);
    const ctx = createMockContext();

    await hook.call(ctx as any, { id: "auth:login" } as any);
    expect(confirm).toHaveBeenCalled();
  });

  it("detects newer minor version", async () => {
    mockFetch({ latest: "1.1.0" });
    (confirm as Mock).mockResolvedValue(false);
    const ctx = createMockContext();

    await hook.call(ctx as any, { id: "auth:login" } as any);
    expect(confirm).toHaveBeenCalled();
  });

  it("detects newer patch version", async () => {
    mockFetch({ latest: "1.0.1" });
    (confirm as Mock).mockResolvedValue(false);
    const ctx = createMockContext();

    await hook.call(ctx as any, { id: "auth:login" } as any);
    expect(confirm).toHaveBeenCalled();
  });

  it("does not prompt when current is newer", async () => {
    mockFetch({ latest: "0.9.0" });
    const ctx = createMockContext();

    await hook.call(ctx as any, { id: "auth:login" } as any);
    expect(ctx.log).not.toHaveBeenCalled();
  });

  it("saves fetched version to global config", async () => {
    mockFetch({ latest: "2.0.0" });
    (confirm as Mock).mockResolvedValue(false);
    const ctx = createMockContext();

    await hook.call(ctx as any, { id: "auth:login" } as any);

    expect(saveGlobalConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        last_known_version: "2.0.0",
        last_version_check: expect.any(Number),
      }),
    );
  });

  it("uses cached version when check is fresh", async () => {
    global.fetch = vi.fn();
    (loadGlobalConfig as Mock).mockReturnValue({
      last_version_check: Date.now() - 1000,
      last_known_version: "2.0.0",
    });
    (confirm as Mock).mockResolvedValue(false);
    const ctx = createMockContext();

    await hook.call(ctx as any, { id: "auth:login" } as any);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalled();
    expect(ctx.log).toHaveBeenCalled();
  });

  it("detects newer dev prerelease version", async () => {
    (getCliVersion as Mock).mockReturnValue("1.0.0-dev.1");
    (getBuildType as Mock).mockReturnValue("dev");
    mockFetch({ dev: "1.0.0-dev.2" });
    (confirm as Mock).mockResolvedValue(false);
    const ctx = createMockContext();

    await hook.call(ctx as any, { id: "auth:login" } as any);
    expect(confirm).toHaveBeenCalled();
  });

  it("detects release as newer than prerelease with same version", async () => {
    (getCliVersion as Mock).mockReturnValue("1.0.0-dev.1");
    (getBuildType as Mock).mockReturnValue("dev");
    mockFetch({ dev: "1.0.0" });
    (confirm as Mock).mockResolvedValue(false);
    const ctx = createMockContext();

    await hook.call(ctx as any, { id: "auth:login" } as any);
    expect(confirm).toHaveBeenCalled();
  });

  it("does not prompt when current dev prerelease is same as latest", async () => {
    (getCliVersion as Mock).mockReturnValue("1.0.0-dev.1");
    (getBuildType as Mock).mockReturnValue("dev");
    mockFetch({ dev: "1.0.0-dev.1" });
    const ctx = createMockContext();

    await hook.call(ctx as any, { id: "auth:login" } as any);
    expect(ctx.log).not.toHaveBeenCalled();
  });

  it("does not prompt when current dev prerelease is newer than latest", async () => {
    (getCliVersion as Mock).mockReturnValue("1.0.0-dev.3");
    (getBuildType as Mock).mockReturnValue("dev");
    mockFetch({ dev: "1.0.0-dev.2" });
    const ctx = createMockContext();

    await hook.call(ctx as any, { id: "auth:login" } as any);
    expect(ctx.log).not.toHaveBeenCalled();
  });

  it("does not re-prompt after user declines (snoozes for 24h)", async () => {
    mockFetch({ latest: "2.0.0" });
    (confirm as Mock).mockResolvedValue(false);
    const ctx = createMockContext();

    await hook.call(ctx as any, { id: "auth:login" } as any);

    expect(upgradePackage).not.toHaveBeenCalled();
    // Should save last_version_check to snooze the prompt
    expect(saveGlobalConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({
        last_version_check: expect.any(Number),
      }),
    );
    // Verify the timestamp is recent (within last 5 seconds)
    const savedConfig = (saveGlobalConfig as Mock).mock.calls.at(-1)?.[0];
    expect(savedConfig.last_version_check).toBeGreaterThan(Date.now() - 5000);
  });

  it("re-fetches when cache is stale", async () => {
    const twentyFiveHoursAgo = Date.now() - 25 * 60 * 60 * 1000;
    (loadGlobalConfig as Mock).mockReturnValue({
      last_version_check: twentyFiveHoursAgo,
      last_known_version: "1.5.0",
    });
    mockFetch({ latest: "2.0.0" });
    (confirm as Mock).mockResolvedValue(false);
    const ctx = createMockContext();

    await hook.call(ctx as any, { id: "auth:login" } as any);

    expect(global.fetch).toHaveBeenCalled();
    expect(saveGlobalConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        last_known_version: "2.0.0",
      }),
    );
  });
});
