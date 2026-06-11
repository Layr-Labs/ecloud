import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Address } from "viem";

const APP_A = "0x01d3e5851c5F361b4E4988fd3cCc503a6D7b5c09" as Address;
const APP_B = "0x02d3e5851c5F361b4E4988fd3cCc503a6D7b5c10" as Address;

// SDK: getAllAppsByDeveloper + UserApiClient
const getAllAppsByDeveloper = vi.fn();
vi.mock("@layr-labs/ecloud-sdk", () => ({
  getEnvironmentConfig: vi.fn(() => ({ name: "sepolia-dev", defaultRPCURL: "https://rpc.test" })),
  getAllAppsByDeveloper: (...a: unknown[]) => getAllAppsByDeveloper(...(a as [])),
  UserApiClient: class {},
}));

// viem clients (CLI wrapper)
vi.mock("../viemClients", () => ({
  createViemClients: vi.fn(() => ({
    publicClient: {},
    walletClient: { account: { address: "0xdev" } },
    address: "0xdev",
  })),
}));

vi.mock("../version", () => ({ getClientId: vi.fn(() => "test") }));

// profile-name resolution
const getAppInfosChunked = vi.fn();
vi.mock("../appResolver", () => ({
  getAppInfosChunked: (...a: unknown[]) => getAppInfosChunked(...(a as [])),
}));

import { findLiveAppByName } from "../appCollision";

const ARGS = {
  environment: "sepolia-dev",
  privateKey: "0xkey",
  rpcUrl: "https://rpc.test",
};

const RUNNING = 1;
const TERMINATED = 3;

describe("findLiveAppByName", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the address of a live app with a matching profile name", async () => {
    getAllAppsByDeveloper.mockResolvedValue({
      apps: [APP_A],
      appConfigs: [{ status: RUNNING }],
    });
    getAppInfosChunked.mockResolvedValue([{ address: APP_A, status: "Running", profile: { name: "foo" } }]);

    const hit = await findLiveAppByName({ ...ARGS, name: "foo" });
    expect(hit).toBe(APP_A);
  });

  it("ignores a terminated app with the same name", async () => {
    getAllAppsByDeveloper.mockResolvedValue({
      apps: [APP_A],
      appConfigs: [{ status: TERMINATED }],
    });
    getAppInfosChunked.mockResolvedValue([]);

    const hit = await findLiveAppByName({ ...ARGS, name: "foo" });
    expect(hit).toBeUndefined();
    expect(getAppInfosChunked).toHaveBeenCalledWith(expect.anything(), []);
  });

  it("returns undefined when no live app's name matches", async () => {
    getAllAppsByDeveloper.mockResolvedValue({
      apps: [APP_A, APP_B],
      appConfigs: [{ status: RUNNING }, { status: RUNNING }],
    });
    getAppInfosChunked.mockResolvedValue([
      { address: APP_A, status: "Running", profile: { name: "bar" } },
      { address: APP_B, status: "Running", profile: { name: "baz" } },
    ]);

    const hit = await findLiveAppByName({ ...ARGS, name: "foo" });
    expect(hit).toBeUndefined();
  });

  it("matches case-insensitively and ignores surrounding whitespace", async () => {
    getAllAppsByDeveloper.mockResolvedValue({
      apps: [APP_A],
      appConfigs: [{ status: RUNNING }],
    });
    getAppInfosChunked.mockResolvedValue([{ address: APP_A, status: "Running", profile: { name: "Foo" } }]);

    const hit = await findLiveAppByName({ ...ARGS, name: "  FOO  " });
    expect(hit).toBe(APP_A);
  });

  it("ignores live apps that have no profile name yet", async () => {
    getAllAppsByDeveloper.mockResolvedValue({
      apps: [APP_A],
      appConfigs: [{ status: RUNNING }],
    });
    getAppInfosChunked.mockResolvedValue([{ address: APP_A, status: "Running", profile: undefined }]);

    const hit = await findLiveAppByName({ ...ARGS, name: "foo" });
    expect(hit).toBeUndefined();
  });

  it("fails open (returns undefined) when enumeration throws", async () => {
    getAllAppsByDeveloper.mockRejectedValue(new Error("rpc down"));

    const hit = await findLiveAppByName({ ...ARGS, name: "foo" });
    expect(hit).toBeUndefined();
  });

  it("fails open (returns undefined) when profile resolution throws", async () => {
    getAllAppsByDeveloper.mockResolvedValue({
      apps: [APP_A],
      appConfigs: [{ status: RUNNING }],
    });
    getAppInfosChunked.mockRejectedValue(new Error("userapi 500"));

    const hit = await findLiveAppByName({ ...ARGS, name: "foo" });
    expect(hit).toBeUndefined();
  });
});
