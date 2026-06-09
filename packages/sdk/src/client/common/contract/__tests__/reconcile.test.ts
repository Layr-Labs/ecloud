import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { reconcileReleaseDigest, normalizeDigest } from "../reconcile";

// Minimal UserApiClient stand-in: only getApp is used.
function clientReturning(...digestsPerCall: Array<string | undefined>) {
  let i = 0;
  return {
    getApp: vi.fn(async () => {
      const d = digestsPerCall[Math.min(i, digestsPerCall.length - 1)];
      i++;
      return { id: "0xapp", releases: d === undefined ? [] : [{ imageDigest: d }] };
    }),
  } as any;
}

describe("normalizeDigest", () => {
  it("strips sha256: and 0x prefixes and lowercases", () => {
    const hex = "a".repeat(64);
    expect(normalizeDigest(`sha256:${hex.toUpperCase()}`)).toBe(hex);
    expect(normalizeDigest(`0x${hex}`)).toBe(hex);
    expect(normalizeDigest(hex)).toBe(hex);
  });
  it("returns empty string for undefined", () => {
    expect(normalizeDigest(undefined)).toBe("");
  });
});

describe("reconcileReleaseDigest", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const DIGEST = `sha256:${"b".repeat(64)}`;

  it("returns matched immediately when the first read already matches", async () => {
    const client = clientReturning(DIGEST);
    const p = reconcileReleaseDigest(client, "0xapp", DIGEST, { intervalMs: 1000, timeoutMs: 10000 });
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.matched).toBe(true);
    expect(client.getApp).toHaveBeenCalledTimes(1);
  });

  it("matches after several polls (digest catches up)", async () => {
    const client = clientReturning(`sha256:${"c".repeat(64)}`, undefined, DIGEST);
    const p = reconcileReleaseDigest(client, "0xapp", DIGEST, { intervalMs: 1000, timeoutMs: 10000 });
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.matched).toBe(true);
    expect(client.getApp.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("returns matched:false after the timeout when the digest never appears", async () => {
    const client = clientReturning(`sha256:${"c".repeat(64)}`);
    const p = reconcileReleaseDigest(client, "0xapp", DIGEST, { intervalMs: 1000, timeoutMs: 3000 });
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.matched).toBe(false);
    expect(result.lastDigest).toBe(`sha256:${"c".repeat(64)}`);
  });

  it("treats a read error as a non-match and keeps polling until match", async () => {
    let call = 0;
    const client = {
      getApp: vi.fn(async () => {
        call++;
        if (call === 1) throw new Error("indexer 500");
        return { id: "0xapp", releases: [{ imageDigest: DIGEST }] };
      }),
    } as any;
    const p = reconcileReleaseDigest(client, "0xapp", DIGEST, { intervalMs: 1000, timeoutMs: 10000 });
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.matched).toBe(true);
    expect(call).toBeGreaterThanOrEqual(2);
  });

  it("returns matched:false immediately when the expected digest is empty", async () => {
    const client = clientReturning(`sha256:${"e".repeat(64)}`);
    const p = reconcileReleaseDigest(client, "0xapp", "", { intervalMs: 1000, timeoutMs: 10000 });
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.matched).toBe(false);
    expect(result.elapsedMs).toBe(0);
    expect(client.getApp).not.toHaveBeenCalled();
  });

  it("matches regardless of digest prefix/case differences", async () => {
    const client = clientReturning(`0x${"d".repeat(64)}`);
    const p = reconcileReleaseDigest(client, "0xapp", `sha256:${"D".repeat(64)}`, { intervalMs: 1000, timeoutMs: 5000 });
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.matched).toBe(true);
  });
});
