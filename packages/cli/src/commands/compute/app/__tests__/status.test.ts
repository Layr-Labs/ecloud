import { describe, it, expect, vi, beforeEach } from "vitest";

const APP = "0x01d3e5851c5F361b4E4988fd3cCc503a6D7b5c09";

const getStatuses = vi.fn();
vi.mock("@layr-labs/ecloud-sdk", () => ({
  getEnvironmentConfig: vi.fn(() => ({ defaultRPCURL: "https://rpc.test" })),
  UserApiClient: class {
    getStatuses = getStatuses;
  },
  WatchTimeoutError: class WatchTimeoutError extends Error {},
}));
vi.mock("../../../../flags", () => ({
  commonFlags: {},
  validateCommonFlags: vi.fn(async (f: Record<string, unknown>) => ({
    ...f,
    environment: "sepolia-dev",
    "private-key": "0xkey",
  })),
}));
vi.mock("../../../../utils/prompts", () => ({
  getOrPromptAppID: vi.fn(async () => APP),
}));
vi.mock("../../../../utils/version", () => ({ getClientId: vi.fn(() => "test") }));
vi.mock("../../../../utils/viemClients", () => ({
  createViemClients: vi.fn(() => ({ publicClient: {}, walletClient: {} })),
}));
const watchDeployment = vi.fn();
const createComputeClient = vi.fn(async () => ({ app: { watchDeployment } }));
vi.mock("../../../../client", () => ({
  createComputeClient: (...args: unknown[]) => createComputeClient(...(args as [])),
}));

describe("compute app status", () => {
  let logOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    logOutput = [];
  });

  async function runCommand(flags: Record<string, unknown>) {
    const { default: AppStatus } = await import("../status");
    const cmd = new AppStatus([], {} as any);
    cmd.parse = vi.fn().mockResolvedValue({ args: { "app-id": APP }, flags });
    cmd.log = vi.fn((...a: string[]) => logOutput.push(a.join(" ")));
    cmd.warn = vi.fn() as any;
    await cmd.run();
    return logOutput;
  }

  it("prints the one-shot status from getStatuses", async () => {
    getStatuses.mockResolvedValue([{ address: APP, status: "Running" }]);
    const out = await runCommand({ wait: false, json: false });
    expect(getStatuses).toHaveBeenCalledWith([APP]);
    expect(watchDeployment).not.toHaveBeenCalled();
    expect(out.join("\n")).toContain("Running");
  });

  it("emits machine-readable JSON with --json", async () => {
    getStatuses.mockResolvedValue([{ address: APP, status: "Terminated" }]);
    const out = await runCommand({ wait: false, json: true });
    expect(JSON.parse(out[0])).toEqual({ appId: APP, status: "Terminated" });
  });

  it("falls back to Unknown when the API returns nothing", async () => {
    getStatuses.mockResolvedValue([]);
    const out = await runCommand({ wait: false, json: true });
    expect(JSON.parse(out[0])).toEqual({ appId: APP, status: "Unknown" });
  });

  it("--wait blocks via watchDeployment for transitional statuses, then does a final status read", async () => {
    // Initial read: still deploying -> should wait. Final read: settled.
    getStatuses
      .mockResolvedValueOnce([{ address: APP, status: "Deploying" }])
      .mockResolvedValueOnce([{ address: APP, status: "Running" }]);
    watchDeployment.mockResolvedValue(undefined);
    const out = await runCommand({ wait: true, json: true, "watch-timeout": 30 });
    expect(watchDeployment).toHaveBeenCalledWith(APP, { timeoutSeconds: 30 });
    expect(JSON.parse(out[0])).toEqual({ appId: APP, status: "Running" });
  });

  it("--wait returns immediately for Running without watching", async () => {
    getStatuses.mockResolvedValue([{ address: APP, status: "Running" }]);
    const out = await runCommand({ wait: true, json: false });
    expect(watchDeployment).not.toHaveBeenCalled();
    expect(out.join("\n")).toContain("Running");
  });

  it("--wait returns immediately for Terminated without watching", async () => {
    getStatuses.mockResolvedValue([{ address: APP, status: "Terminated" }]);
    const out = await runCommand({ wait: true, json: true });
    expect(watchDeployment).not.toHaveBeenCalled();
    expect(JSON.parse(out[0])).toEqual({ appId: APP, status: "Terminated" });
  });

  it("--wait returns immediately for Stopped without watching", async () => {
    getStatuses.mockResolvedValue([{ address: APP, status: "Stopped" }]);
    const out = await runCommand({ wait: true, json: true });
    expect(watchDeployment).not.toHaveBeenCalled();
    expect(JSON.parse(out[0])).toEqual({ appId: APP, status: "Stopped" });
  });

  it("--wait --json keeps stdout pure JSON by routing SDK progress off stdout", async () => {
    // Transitional initial status forces a watch; the SDK progress logger
    // must not be allowed to write to stdout or it corrupts the JSON.
    getStatuses
      .mockResolvedValueOnce([{ address: APP, status: "Deploying" }])
      .mockResolvedValueOnce([{ address: APP, status: "Running" }]);
    watchDeployment.mockResolvedValue(undefined);

    const out = await runCommand({ wait: true, json: true, "watch-timeout": 30 });

    // The compute client must be built with a logger override so the SDK
    // does not print "Waiting for app to start..." / "Status: ..." to stdout.
    const clientOpts = createComputeClient.mock.calls[0]?.[1] as { logger?: unknown } | undefined;
    expect(clientOpts?.logger).toBeDefined();

    // stdout is exactly one line, and that line is the JSON object.
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0])).toEqual({ appId: APP, status: "Running" });
  });
});
