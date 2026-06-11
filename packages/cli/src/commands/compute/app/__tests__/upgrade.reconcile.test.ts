import { describe, it, expect, vi, beforeEach } from "vitest";

const reconcileReleaseDigest = vi.fn();

import { reconcileAndReport } from "../upgrade";

function makeCmd() {
  const logs: string[] = [];
  const warns: string[] = [];
  return {
    logs,
    warns,
    cmd: {
      log: (m = "") => logs.push(m),
      warn: (m: string) => warns.push(m),
      debug: (_m: string) => {},
    },
  };
}

const APP = "0x01d3e5851c5F361b4E4988fd3cCc503a6D7b5c09";
const DIGEST = `sha256:${"a".repeat(64)}`;

describe("reconcileAndReport", () => {
  beforeEach(() => vi.clearAllMocks());

  it("logs the confirmed digest when reconciliation matches", async () => {
    const compute = { app: { reconcileReleaseDigest: reconcileReleaseDigest.mockResolvedValue({ matched: true, lastDigest: DIGEST, elapsedMs: 10 }) } };
    const { cmd, logs, warns } = makeCmd();
    await reconcileAndReport(cmd as any, compute as any, APP, DIGEST);
    expect(reconcileReleaseDigest).toHaveBeenCalledWith(APP, DIGEST);
    expect(logs.join("\n")).toContain(DIGEST);
    expect(warns).toHaveLength(0);
  });

  it("warns about pending propagation when reconciliation times out", async () => {
    const compute = { app: { reconcileReleaseDigest: reconcileReleaseDigest.mockResolvedValue({ matched: false, lastDigest: "sha256:old", elapsedMs: 45000 }) } };
    const { cmd, warns } = makeCmd();
    await reconcileAndReport(cmd as any, compute as any, APP, DIGEST);
    expect(warns).toHaveLength(1);
    expect(warns[0].toLowerCase()).toContain("propagation");
    expect(warns[0]).toContain(APP);
  });

  it("skips silently when no expected digest is known", async () => {
    const compute = { app: { reconcileReleaseDigest } };
    const { cmd, warns } = makeCmd();
    await reconcileAndReport(cmd as any, compute as any, APP, undefined);
    expect(reconcileReleaseDigest).not.toHaveBeenCalled();
    expect(warns).toHaveLength(0);
  });

  it("fails open (no throw, no warn) when reconciliation itself errors", async () => {
    const compute = { app: { reconcileReleaseDigest: reconcileReleaseDigest.mockRejectedValue(new Error("boom")) } };
    const { cmd, warns } = makeCmd();
    await expect(reconcileAndReport(cmd as any, compute as any, APP, DIGEST)).resolves.toBeUndefined();
    expect(warns).toHaveLength(0);
  });
});
