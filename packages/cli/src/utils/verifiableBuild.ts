import type {
  Build,
  BuildModule,
  SubmitBuildRequest,
  VerifyProvenanceSuccess,
} from "@layr-labs/ecloud-sdk";
import { BUILD_STATUS, ConflictError } from "@layr-labs/ecloud-sdk";

export interface RunVerifiableBuildOptions {
  onLog?: (chunk: string) => void;
}

export interface VerifiableBuildResult {
  /** Canonical build object (from `get(buildId)`) including resolved dependency builds. */
  build: Build;
  /** Verified provenance response (from `verify(buildId)`). */
  verified: VerifyProvenanceSuccess;
}

export function assertCommitSha40(commit: string): void {
  if (!/^[0-9a-f]{40}$/i.test(commit)) {
    throw new Error("Commit must be a 40-character hexadecimal SHA");
  }
}

/**
 * Build IDs are UUIDs (returned by the Build API).
 *
 * Validate client-side so common typos produce a clear "Invalid build ID"
 * instead of a misleading "not found" response from the API.
 */
export function assertBuildId(buildId: string): void {
  const trimmed = String(buildId ?? "").trim();
  // UUID v1-v5 (canonical 8-4-4-4-12), case-insensitive.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(trimmed)) {
    throw new Error(`Invalid build ID: '${buildId}' (expected a UUID)`);
  }
}

/**
 * Run a verifiable build to completion and verify provenance.
 *
 * - Uses `submit()` + `waitForBuild()` to stream logs.
 * - Fetches canonical build via `get()` so `.dependencies` is populated.
 * - Verifies provenance via `verify()` and throws if not verified.
 *
 * @param canForceParallelBuild - Optional callback that returns true if the user has
 *   sufficient credits (>= $5) to run parallel builds. When provided, a 409 conflict
 *   (build already in progress) will trigger this check and retry with force if allowed.
 */
export async function runVerifiableBuildAndVerify(
  client: BuildModule,
  request: SubmitBuildRequest,
  options: RunVerifiableBuildOptions = {},
  canForceParallelBuild?: () => Promise<boolean>,
): Promise<VerifiableBuildResult> {
  // Submit build, retrying with force on conflict if credits allow
  let buildId: string;
  try {
    ({ buildId } = await client.submit(request));
  } catch (error) {
    if (!(error instanceof ConflictError) || !canForceParallelBuild) throw error;
    const allowed = await canForceParallelBuild();
    if (!allowed) throw error;
    ({ buildId } = await client.submit({ ...request, force: true }));
  }

  // Wait for completion (streams logs)
  const completed = await client.waitForBuild(buildId, { onLog: options.onLog });
  if (completed.status !== BUILD_STATUS.SUCCESS) {
    // Defensive: waitForBuild should throw on failed, but keep this explicit.
    throw new Error(`Build did not complete successfully (status: ${completed.status})`);
  }

  const [build, verify] = await Promise.all([client.get(buildId), client.verify(buildId)]);

  if (verify.status !== "verified") {
    throw new Error(`Provenance verification failed: ${verify.error}`);
  }

  return { build, verified: verify };
}
