import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveDockerHubImageDigest } from "../dockerhub";

const IMAGE = "docker.io/eigenlayer/eigencloud-containers:demo";
const DIGEST = "sha256:" + "a".repeat(64);

/** Build a fetch stub that routes by URL/method to canned responses. */
function stubFetch(handlers: {
  manifestList?: unknown; // multi-platform index returned for the manifest GET
  singleManifest?: { config: { digest: string } }; // single-platform manifest
  config?: { os?: string; architecture?: string }; // config blob
}) {
  const json = (body: unknown, headers: Record<string, string> = {}) =>
    ({
      ok: true,
      status: 200,
      headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
      json: async () => body,
      text: async () => JSON.stringify(body),
    }) as unknown as Response;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: { method?: string }) => {
      const url = input.toString();
      const method = init?.method ?? "GET";

      if (url.includes("auth.docker.io/token")) return json({ token: "t" });

      if (url.includes("/manifests/")) {
        // The digest HEAD/GET: return the content-digest header.
        if (method === "HEAD") return json({}, { "docker-content-digest": DIGEST });
        // The platform-check GET (Accept includes index types) OR digest GET fallback.
        if (handlers.manifestList)
          return json(handlers.manifestList, { "docker-content-digest": DIGEST });
        return json(handlers.singleManifest ?? {}, { "docker-content-digest": DIGEST });
      }

      if (url.includes("/blobs/")) return json(handlers.config ?? {});

      throw new Error(`unexpected fetch: ${method} ${url}`);
    }),
  );
}

describe("resolveDockerHubImageDigest amd64 enforcement (RND-597)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts a multi-platform image that includes linux/amd64", async () => {
    stubFetch({
      manifestList: {
        manifests: [
          { platform: { os: "linux", architecture: "arm64" } },
          { platform: { os: "linux", architecture: "amd64" } },
        ],
      },
    });
    await expect(resolveDockerHubImageDigest(IMAGE)).resolves.toBe(DIGEST);
  });

  it("rejects a multi-platform image with no linux/amd64 entry", async () => {
    stubFetch({
      manifestList: { manifests: [{ platform: { os: "linux", architecture: "arm64" } }] },
    });
    await expect(resolveDockerHubImageDigest(IMAGE)).rejects.toThrow(/linux\/amd64/);
  });

  it("accepts a single-platform linux/amd64 image (config blob)", async () => {
    stubFetch({
      singleManifest: { config: { digest: "sha256:" + "c".repeat(64) } },
      config: { os: "linux", architecture: "amd64" },
    });
    await expect(resolveDockerHubImageDigest(IMAGE)).resolves.toBe(DIGEST);
  });

  it("rejects a single-platform arm64 image", async () => {
    stubFetch({
      singleManifest: { config: { digest: "sha256:" + "c".repeat(64) } },
      config: { os: "linux", architecture: "arm64" },
    });
    await expect(resolveDockerHubImageDigest(IMAGE)).rejects.toThrow(/linux\/amd64/);
  });
});
