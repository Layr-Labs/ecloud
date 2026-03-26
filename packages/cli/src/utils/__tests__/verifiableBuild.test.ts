import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConflictError } from "@layr-labs/ecloud-sdk";
import type { BuildModule, Build, SubmitBuildRequest } from "@layr-labs/ecloud-sdk";
import { runVerifiableBuildAndVerify } from "../verifiableBuild";

const BUILD_ID = "a1b2c3d4-e5f6-1a2b-9c8d-e7f6a5b4c3d2";

const SAMPLE_REQUEST: SubmitBuildRequest = {
  repoUrl: "https://github.com/test/repo",
  gitRef: "a".repeat(40),
  dockerfilePath: "Dockerfile",
  buildContextPath: ".",
};

const SUCCESSFUL_BUILD: Build = {
  buildId: BUILD_ID,
  billingAddress: "0x1234",
  repoUrl: SAMPLE_REQUEST.repoUrl,
  gitRef: SAMPLE_REQUEST.gitRef,
  status: "success",
  buildType: "application",
  imageName: "test-image",
  imageUrl: "registry.example.com/test:latest",
  imageDigest: "sha256:abc123",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:01:00Z",
};

const VERIFIED_RESULT = {
  status: "verified" as const,
  buildId: BUILD_ID,
  imageUrl: "registry.example.com/test:latest",
  imageDigest: "sha256:abc123",
  repoUrl: SAMPLE_REQUEST.repoUrl,
  gitRef: SAMPLE_REQUEST.gitRef,
  provenanceJson: {},
  provenanceSignature: "sig-abc",
  payloadType: "application/vnd.in-toto+json",
  payload: "{}",
};

function createMockClient(overrides: Partial<BuildModule> = {}): BuildModule {
  return {
    submit: vi.fn().mockResolvedValue({ buildId: BUILD_ID }),
    get: vi.fn().mockResolvedValue(SUCCESSFUL_BUILD),
    getLogs: vi.fn().mockResolvedValue(""),
    list: vi.fn().mockResolvedValue([]),
    getByDigest: vi.fn(),
    verify: vi.fn().mockResolvedValue(VERIFIED_RESULT),
    submitAndWait: vi.fn(),
    waitForBuild: vi.fn().mockResolvedValue(SUCCESSFUL_BUILD),
    streamLogs: vi.fn(),
    ...overrides,
  } as unknown as BuildModule;
}

describe("runVerifiableBuildAndVerify", () => {
  it("submits, waits, and verifies on happy path", async () => {
    const client = createMockClient();

    const result = await runVerifiableBuildAndVerify(client, SAMPLE_REQUEST);

    expect(client.submit).toHaveBeenCalledTimes(1);
    expect(client.submit).toHaveBeenCalledWith(SAMPLE_REQUEST);
    expect(client.waitForBuild).toHaveBeenCalledWith(BUILD_ID, { onLog: undefined });
    expect(client.get).toHaveBeenCalledWith(BUILD_ID);
    expect(client.verify).toHaveBeenCalledWith(BUILD_ID);
    expect(result.build).toEqual(SUCCESSFUL_BUILD);
    expect(result.verified).toEqual(VERIFIED_RESULT);
  });

  describe("conflict retry", () => {
    it("retries with force when conflict occurs and canForceParallelBuild returns true", async () => {
      const submit = vi
        .fn()
        .mockRejectedValueOnce(new ConflictError())
        .mockResolvedValueOnce({ buildId: BUILD_ID });

      const client = createMockClient({ submit });
      const canForce = vi.fn().mockResolvedValue(true);

      const result = await runVerifiableBuildAndVerify(
        client,
        SAMPLE_REQUEST,
        {},
        canForce,
      );

      expect(submit).toHaveBeenCalledTimes(2);
      expect(submit).toHaveBeenNthCalledWith(1, SAMPLE_REQUEST);
      expect(submit).toHaveBeenNthCalledWith(2, { ...SAMPLE_REQUEST, force: true });
      expect(canForce).toHaveBeenCalledTimes(1);
      expect(result.build).toEqual(SUCCESSFUL_BUILD);
    });

    it("re-throws ConflictError when canForceParallelBuild returns false", async () => {
      const submit = vi.fn().mockRejectedValue(new ConflictError());
      const client = createMockClient({ submit });
      const canForce = vi.fn().mockResolvedValue(false);

      await expect(
        runVerifiableBuildAndVerify(client, SAMPLE_REQUEST, {}, canForce),
      ).rejects.toThrow(ConflictError);

      expect(submit).toHaveBeenCalledTimes(1);
      expect(canForce).toHaveBeenCalledTimes(1);
    });

    it("re-throws ConflictError when no canForceParallelBuild callback provided", async () => {
      const submit = vi.fn().mockRejectedValue(new ConflictError());
      const client = createMockClient({ submit });

      await expect(
        runVerifiableBuildAndVerify(client, SAMPLE_REQUEST),
      ).rejects.toThrow(ConflictError);

      expect(submit).toHaveBeenCalledTimes(1);
    });

    it("does not catch non-ConflictError errors", async () => {
      const submit = vi.fn().mockRejectedValue(new Error("network error"));
      const client = createMockClient({ submit });
      const canForce = vi.fn().mockResolvedValue(true);

      await expect(
        runVerifiableBuildAndVerify(client, SAMPLE_REQUEST, {}, canForce),
      ).rejects.toThrow("network error");

      expect(canForce).not.toHaveBeenCalled();
    });
  });

  it("throws when provenance verification fails", async () => {
    const client = createMockClient({
      verify: vi.fn().mockResolvedValue({ status: "failed", error: "bad sig" }),
    });

    await expect(
      runVerifiableBuildAndVerify(client, SAMPLE_REQUEST),
    ).rejects.toThrow("Provenance verification failed: bad sig");
  });

  it("passes onLog option to waitForBuild", async () => {
    const client = createMockClient();
    const onLog = vi.fn();

    await runVerifiableBuildAndVerify(client, SAMPLE_REQUEST, { onLog });

    expect(client.waitForBuild).toHaveBeenCalledWith(BUILD_ID, { onLog });
  });
});
