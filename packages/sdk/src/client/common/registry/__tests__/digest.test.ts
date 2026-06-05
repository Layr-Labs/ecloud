import { afterEach, describe, expect, it, vi } from "vitest";

// Mock child_process.execFile so promisify(execFile) is drivable. The real
// signature is execFile(cmd, args, opts, cb); promisify calls the (err, {stdout})
// node-style callback. We route by the docker subcommand.
const responses: Record<string, string> = {};
vi.mock("child_process", () => ({
  execFile: (
    _cmd: string,
    args: string[],
    _opts: unknown,
    cb: (err: Error | null, res?: { stdout: string; stderr: string }) => void,
  ) => {
    const sub = args[0]; // "manifest" | "inspect"
    const key = sub === "manifest" ? "manifest" : "inspect";
    const out = responses[key];
    if (out === undefined) {
      cb(new Error(`no mock for docker ${args.join(" ")}`));
      return;
    }
    cb(null, { stdout: out, stderr: "" });
  },
}));

import { getImageDigestAndName } from "../digest";

describe("getImageDigestAndName amd64 enforcement", () => {
  afterEach(() => {
    for (const k of Object.keys(responses)) delete responses[k];
    vi.clearAllMocks();
  });

  it("throws (fail closed) when architecture is undetectable — no assume-amd64", async () => {
    // Single-platform manifest (no .manifests[]), so it calls `docker inspect`,
    // whose output has NO Architecture field but the manifest has a config digest.
    responses.manifest = JSON.stringify({ config: { digest: "sha256:" + "b".repeat(64) } });
    responses.inspect = JSON.stringify([{ Os: "linux" /* Architecture missing */ }]);

    await expect(getImageDigestAndName("docker.io/x/y:tag")).rejects.toThrow(/linux\/amd64/);
  });

  it("rejects a single-platform arm64 image", async () => {
    responses.manifest = JSON.stringify({ config: { digest: "sha256:" + "b".repeat(64) } });
    responses.inspect = JSON.stringify([
      { Os: "linux", Architecture: "arm64", RepoDigests: ["x@sha256:" + "c".repeat(64)] },
    ]);

    await expect(getImageDigestAndName("docker.io/x/y:tag")).rejects.toThrow(/linux\/amd64/);
  });

  it("rejects a multi-platform image with no linux/amd64 entry", async () => {
    responses.manifest = JSON.stringify({
      manifests: [
        { digest: "sha256:" + "d".repeat(64), platform: { os: "linux", architecture: "arm64" } },
      ],
    });
    await expect(getImageDigestAndName("docker.io/x/y:tag")).rejects.toThrow(/linux\/amd64/);
  });

  it("remediation offers buildx and the --verifiable --repo --commit server-side path", async () => {
    // The remediation must point at both fixes a non-amd64 --image-ref has:
    // rebuild for amd64 with buildx, OR switch to a server-side verifiable build
    // (which needs no local Docker at all). Kept consistent with the CLI's
    // prebuilt-image rejection so both arm64 entry points say the same thing.
    responses.manifest = JSON.stringify({
      manifests: [
        { digest: "sha256:" + "d".repeat(64), platform: { os: "linux", architecture: "arm64" } },
      ],
    });
    await expect(getImageDigestAndName("docker.io/x/y:tag")).rejects.toThrow(/buildx/);
    await expect(getImageDigestAndName("docker.io/x/y:tag")).rejects.toThrow(
      /--verifiable --repo .* --commit/,
    );
  });
});
