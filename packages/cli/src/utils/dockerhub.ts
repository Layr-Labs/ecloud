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
  return digest;
}
