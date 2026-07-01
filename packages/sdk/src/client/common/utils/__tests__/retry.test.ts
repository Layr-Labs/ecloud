import { afterEach, describe, expect, it, vi } from "vitest";

// Mock axios so requestWithRetry's HTTP calls are controllable.
const axiosMock = vi.fn();
vi.mock("axios", () => ({
  default: (config: unknown) => axiosMock(config),
}));

import { requestWithRetry } from "../retry";

/**
 * requestWithRetry retries 429 (rate limit) AND transient gateway
 * errors 502/503/504, then returns the last response. 2xx/4xx (other than 429)
 * are returned immediately without retry.
 */
describe("requestWithRetry retryable statuses", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("returns immediately on 200 (no retry)", async () => {
    axiosMock.mockResolvedValueOnce({ status: 200, headers: {}, data: "ok" });
    const res = await requestWithRetry({ url: "x" });
    expect(res.status).toBe(200);
    expect(axiosMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 404", async () => {
    axiosMock.mockResolvedValueOnce({ status: 404, headers: {}, data: "nope" });
    const res = await requestWithRetry({ url: "x" });
    expect(res.status).toBe(404);
    expect(axiosMock).toHaveBeenCalledTimes(1);
  });

  for (const status of [429, 502, 503, 504]) {
    it(`retries ${status} then succeeds`, async () => {
      vi.useFakeTimers();
      axiosMock
        .mockResolvedValueOnce({ status, headers: { "retry-after": "0" }, data: "" })
        .mockResolvedValueOnce({ status: 200, headers: {}, data: "ok" });

      const promise = requestWithRetry({ url: "x" });
      await vi.runAllTimersAsync();
      const res = await promise;

      expect(res.status).toBe(200);
      expect(axiosMock).toHaveBeenCalledTimes(2);
    });
  }
});
