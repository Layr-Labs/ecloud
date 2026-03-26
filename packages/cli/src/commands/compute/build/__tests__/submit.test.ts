import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConflictError } from "@layr-labs/ecloud-sdk";

vi.mock("../../../../client", () => ({
  createBuildClient: vi.fn(),
  createBillingClient: vi.fn(),
}));

vi.mock("../../../../telemetry", () => ({
  withTelemetry: vi.fn((_cmd: unknown, fn: () => Promise<void>) => fn()),
}));

vi.mock("../../../../flags", () => ({
  commonFlags: {},
  validateCommonFlags: vi.fn((f: any) => f),
}));

vi.mock("../../../../utils/prompts", () => ({
  promptVerifiableGitSourceInputs: vi.fn(),
}));

vi.mock("../../../../utils/verifiableBuild", () => ({
  assertCommitSha40: vi.fn(),
  runVerifiableBuildAndVerify: vi.fn(),
}));

vi.mock("../../../../utils/build", () => ({
  formatVerifiableBuildSummary: vi.fn(() => []),
}));

import { createBuildClient, createBillingClient } from "../../../../client";

const COMMIT = "a".repeat(40);
const BUILD_ID = "a1b2c3d4-e5f6-1a2b-9c8d-e7f6a5b4c3d2";

describe("BuildSubmit — submitWithCreditGatedRetry", () => {
  let logOutput: string[];
  let mockBuildClient: { submit: ReturnType<typeof vi.fn> };
  let mockBilling: { getStatus: ReturnType<typeof vi.fn>; address: string };

  beforeEach(() => {
    logOutput = [];
    mockBuildClient = {
      submit: vi.fn().mockResolvedValue({ buildId: BUILD_ID }),
    };
    mockBilling = {
      address: "0xabcdef1234567890abcdef1234567890abcdef12",
      getStatus: vi.fn(),
    };
    (createBuildClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockBuildClient);
    (createBillingClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockBilling);
  });

  async function runSubmitCommand() {
    const { default: BuildSubmit } = await import("../submit");
    const cmd = new BuildSubmit([], {} as any);
    cmd.parse = vi.fn().mockResolvedValue({
      flags: {
        repo: "https://github.com/test/repo",
        commit: COMMIT,
        dockerfile: "Dockerfile",
        context: ".",
        "no-follow": true,
        json: false,
        verbose: false,
        environment: "sepolia",
      },
    });
    cmd.log = vi.fn((...args: string[]) => logOutput.push(args.join(" ")));
    cmd.debug = vi.fn();
    cmd.error = vi.fn((msg: string) => {
      throw new Error(msg);
    }) as any;

    await cmd.run();
    return logOutput;
  }

  it("submits normally when no conflict", async () => {
    await runSubmitCommand();

    expect(mockBuildClient.submit).toHaveBeenCalledTimes(1);
    expect(createBillingClient).not.toHaveBeenCalled();
    expect(logOutput.join("\n")).toContain(BUILD_ID);
  });

  it("retries with force when conflict and credits >= $5", async () => {
    mockBuildClient.submit
      .mockRejectedValueOnce(new ConflictError())
      .mockResolvedValueOnce({ buildId: BUILD_ID });

    mockBilling.getStatus.mockResolvedValue({
      subscriptionStatus: "active",
      productId: "compute",
      remainingCredits: 25.0,
    });

    await runSubmitCommand();

    expect(mockBuildClient.submit).toHaveBeenCalledTimes(2);
    expect(mockBuildClient.submit).toHaveBeenNthCalledWith(2, expect.objectContaining({ force: true }));
    expect(createBillingClient).toHaveBeenCalledTimes(1);

    const fullOutput = logOutput.join("\n");
    expect(fullOutput).toContain("already in progress");
    expect(fullOutput).toContain("$25.00");
    expect(fullOutput).toContain(BUILD_ID);
  });

  it("errors when conflict and credits < $5", async () => {
    mockBuildClient.submit.mockRejectedValue(new ConflictError());
    mockBilling.getStatus.mockResolvedValue({
      subscriptionStatus: "active",
      productId: "compute",
      remainingCredits: 3.5,
    });

    await expect(runSubmitCommand()).rejects.toThrow(/\$3\.50.*\$5\.00/);

    expect(mockBuildClient.submit).toHaveBeenCalledTimes(1);
    expect(createBillingClient).toHaveBeenCalledTimes(1);
  });

  it("errors when conflict and no credits info (undefined)", async () => {
    mockBuildClient.submit.mockRejectedValue(new ConflictError());
    mockBilling.getStatus.mockResolvedValue({
      subscriptionStatus: "active",
      productId: "compute",
    });

    await expect(runSubmitCommand()).rejects.toThrow(/\$0\.00.*\$5\.00/);
  });

  it("retries with force at exactly $5 in credits", async () => {
    mockBuildClient.submit
      .mockRejectedValueOnce(new ConflictError())
      .mockResolvedValueOnce({ buildId: BUILD_ID });

    mockBilling.getStatus.mockResolvedValue({
      subscriptionStatus: "active",
      productId: "compute",
      remainingCredits: 5.0,
    });

    await runSubmitCommand();

    expect(mockBuildClient.submit).toHaveBeenCalledTimes(2);
    expect(mockBuildClient.submit).toHaveBeenNthCalledWith(2, expect.objectContaining({ force: true }));
  });

  it("re-throws non-ConflictError errors without checking credits", async () => {
    mockBuildClient.submit.mockRejectedValue(new Error("network failure"));

    await expect(runSubmitCommand()).rejects.toThrow("network failure");
    expect(createBillingClient).not.toHaveBeenCalled();
  });
});
