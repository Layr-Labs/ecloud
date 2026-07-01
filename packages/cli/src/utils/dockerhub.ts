const DOCKERHUB_OWNER = "eigenlayer";
const DOCKERHUB_REPO = "eigencloud-containers";

export interface DockerHubImageRefParts {
  owner: string;
  repo: string;
  tag: string;
}

/**
 * Parse and validate the required prebuilt verifiable image ref format:
 *   docker.io/eigenlayer/eigencloud-containers:<tag>
 */
export function parseEigencloudContainersImageRef(imageRef: string): DockerHubImageRefParts {
  const trimmed = imageRef.trim();
  const match = /^docker\.io\/([^/]+)\/([^:@]+):([^@\s]+)$/i.exec(trimmed);
  if (!match) {
    throw new Error("Image ref must match docker.io/eigenlayer/eigencloud-containers:<tag>");
  }

  const owner = match[1]!.toLowerCase();
  const repo = match[2]!.toLowerCase();
  const tag = match[3]!;

  if (owner !== DOCKERHUB_OWNER || repo !== DOCKERHUB_REPO) {
    throw new Error(`Image ref must be from docker.io/${DOCKERHUB_OWNER}/${DOCKERHUB_REPO}:<tag>`);
  }
  if (!tag.trim()) {
    throw new Error("Image tag cannot be empty");
  }

  return { owner, repo, tag };
}

export function assertEigencloudContainersImageRef(imageRef: string): void {
  parseEigencloudContainersImageRef(imageRef);
}

async function getDockerHubToken(owner: string, repo: string): Promise<string> {
  const url = new URL("https://auth.docker.io/token");
  url.searchParams.set("service", "registry.docker.io");
  url.searchParams.set("scope", `repository:${owner}/${repo}:pull`);

  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) {
    const body = await safeReadText(res);
    throw new Error(`Failed to fetch Docker Hub token (${res.status}): ${body || res.statusText}`);
  }

  const data = (await res.json()) as { token?: string };
  if (!data.token) {
    throw new Error("Docker Hub token response missing 'token'");
  }
  return data.token;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return (await res.text()).trim();
  } catch {
    return "";
  }
}

/**
 * Resolve docker.io tag -> immutable content digest via Docker Registry HTTP API v2.
 *
 * Returns: sha256:<64hex>
 */
export async function resolveDockerHubImageDigest(imageRef: string): Promise<string> {
  const { owner, repo, tag } = parseEigencloudContainersImageRef(imageRef);
  const token = await getDockerHubToken(owner, repo);

  const manifestUrl = `https://registry-1.docker.io/v2/${owner}/${repo}/manifests/${encodeURIComponent(tag)}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.docker.distribution.manifest.v2+json",
  };

  // Prefer HEAD to avoid downloading the manifest body, but fall back to GET if needed.
  let res = await fetch(manifestUrl, { method: "HEAD", headers });
  if (!res.ok) {
    res = await fetch(manifestUrl, { method: "GET", headers });
  }

  if (!res.ok) {
    const body = await safeReadText(res);
    throw new Error(
      `Failed to resolve digest for ${imageRef} (${res.status}) at ${manifestUrl}: ${
        body || res.statusText
      }`,
    );
  }

  const digest =
    res.headers.get("docker-content-digest") || res.headers.get("Docker-Content-Digest");
  if (!digest) {
    throw new Error(
      `Docker registry response missing Docker-Content-Digest header for ${imageRef}`,
    );
  }
  if (!/^sha256:[0-9a-f]{64}$/i.test(digest)) {
    throw new Error(`Unexpected digest format from Docker registry: ${digest}`);
  }

  // A prebuilt image ref must contain a linux/amd64 image, or it will
  // deploy and then crash on first request in the TEE. The digest fetch above
  // does not look at architecture, so verify it explicitly here.
  await assertImageHasAmd64(owner, repo, tag, token, imageRef);

  return digest;
}

const AMD64_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

/**
 * Verify a Docker Hub tag exposes a linux/amd64 image.
 *
 * - Multi-platform (manifest list / OCI index): require a linux/amd64 entry.
 * - Single-platform: read the config blob's `architecture`/`os` and require
 *   linux/amd64.
 *
 * Throws a remediation error otherwise.
 */
async function assertImageHasAmd64(
  owner: string,
  repo: string,
  tag: string,
  token: string,
  imageRef: string,
): Promise<void> {
  const base = `https://registry-1.docker.io/v2/${owner}/${repo}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: AMD64_ACCEPT };

  const res = await fetch(`${base}/manifests/${encodeURIComponent(tag)}`, { headers });
  if (!res.ok) {
    const body = await safeReadText(res);
    throw new Error(
      `Failed to read manifest for ${imageRef} (${res.status}): ${body || res.statusText}`,
    );
  }
  const manifest = (await res.json()) as {
    manifests?: Array<{ platform?: { os?: string; architecture?: string } }>;
    config?: { digest?: string };
    architecture?: string;
    os?: string;
  };

  const isAmd64 = (os?: string, arch?: string) => os === "linux" && arch === "amd64";

  // Multi-platform: scan the index entries.
  if (Array.isArray(manifest.manifests) && manifest.manifests.length > 0) {
    const platforms = manifest.manifests.map((m) =>
      m.platform ? `${m.platform.os}/${m.platform.architecture}` : "unknown",
    );
    if (manifest.manifests.some((m) => isAmd64(m.platform?.os, m.platform?.architecture))) {
      return;
    }
    throw amd64Error(imageRef, platforms);
  }

  // Single-platform: the architecture lives in the config blob, not the manifest.
  const configDigest = manifest.config?.digest;
  if (!configDigest) {
    throw amd64Error(imageRef, ["unknown (no platform info in manifest)"]);
  }
  const cfgRes = await fetch(`${base}/blobs/${configDigest}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!cfgRes.ok) {
    throw amd64Error(imageRef, ["unknown (could not read image config)"]);
  }
  const cfg = (await cfgRes.json()) as { architecture?: string; os?: string };
  if (isAmd64(cfg.os, cfg.architecture)) {
    return;
  }
  throw amd64Error(imageRef, [`${cfg.os ?? "unknown"}/${cfg.architecture ?? "unknown"}`]);
}

function amd64Error(imageRef: string, platforms: string[]): Error {
  return new Error(
    `ecloud requires linux/amd64 images for TEE deployment.\n\n` +
      `Image: ${imageRef}\n` +
      `Found platform(s): ${platforms.join(", ")}\n` +
      `Required platform: linux/amd64\n\n` +
      `To fix: rebuild for linux/amd64 (e.g. docker buildx build --platform linux/amd64 ... --push), ` +
      `or use a verifiable build (--verifiable --repo <repo> --commit <sha>), which builds server-side.`,
  );
}
