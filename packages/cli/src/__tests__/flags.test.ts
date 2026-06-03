import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the two inputs the environment default depends on.
vi.mock("@layr-labs/ecloud-sdk", () => ({
  getBuildType: vi.fn(),
}));
vi.mock("../utils/globalConfig", () => ({
  getDefaultEnvironment: vi.fn(),
}));

import { commonFlags } from "../flags";
import { getBuildType } from "@layr-labs/ecloud-sdk";
import { getDefaultEnvironment } from "../utils/globalConfig";

/**
 * RND-589: prod builds default --environment to mainnet-alpha (was sepolia);
 * dev builds stay sepolia-dev; an explicit configured default always wins.
 * The default is an async thunk on the oclif flag definition.
 */
describe("commonFlags.environment default (RND-589)", () => {
  // oclif stores the default function on the flag's `default` property.
  const resolveDefault = () =>
    (commonFlags.environment as unknown as { default: () => Promise<string> }).default();

  afterEach(() => vi.clearAllMocks());

  it("defaults to mainnet-alpha on prod builds with no configured default", async () => {
    (getDefaultEnvironment as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (getBuildType as ReturnType<typeof vi.fn>).mockReturnValue("prod");
    await expect(resolveDefault()).resolves.toBe("mainnet-alpha");
  });

  it("defaults to sepolia-dev on dev builds", async () => {
    (getDefaultEnvironment as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (getBuildType as ReturnType<typeof vi.fn>).mockReturnValue("dev");
    await expect(resolveDefault()).resolves.toBe("sepolia-dev");
  });

  it("honors a configured default over the build-type fallback", async () => {
    (getDefaultEnvironment as ReturnType<typeof vi.fn>).mockReturnValue("sepolia");
    (getBuildType as ReturnType<typeof vi.fn>).mockReturnValue("prod");
    await expect(resolveDefault()).resolves.toBe("sepolia");
  });
});
