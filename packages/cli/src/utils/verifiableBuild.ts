import type {
  Build,
  BuildModule,
  SubmitBuildRequest,
  VerifyProvenanceSuccess,
} from "@layr-labs/ecloud-sdk";
import { BUILD_STATUS } from "@layr-labs/ecloud-sdk";

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
 * Run a verifiable build to completion and verify provenance.
 *
 * - Uses `submit()` + `waitForBuild()` to stream logs.
 * - Fetches canonical build via `get()` so `.dependencies` is populated.
 * - Verifies provenance via `verify()` and throws if not verified.
 */
export async function runVerifiableBuildAndVerify(
  client: BuildModule,
  request: SubmitBuildRequest,
  options: RunVerifiableBuildOptions = {},
): Promise<VerifiableBuildResult> {
  // Submit build
  const { buildId } = await client.submit(request);

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
