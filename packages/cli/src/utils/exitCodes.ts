/**
 * Distinct process exit codes for deploy/upgrade so a caller (CI, agent) keying
 * off exit status can tell *which stage* failed.
 *
 * A ~7-minute build that succeeds and then fails on-chain must be
 * distinguishable from a build that never produced an image.
 *
 * Exit code 1 is intentionally NOT defined here: it is oclif's default for any
 * unclassified error (a plain `this.error(msg)` with no `exit` option). The
 * codes below are the stage-specific ones we assign on top of that baseline.
 *
 *   2  invalid or missing input — fails before any build
 *   3  build/push failed — no on-chain transaction was attempted
 *   4  build/push succeeded but the on-chain transaction failed
 *      (the image is already built+pushed; a re-run reuses it)
 */
export const EXIT_CODES = {
  INVALID_INPUT: 2,
  BUILD_FAILED: 3,
  ONCHAIN_FAILED: 4,
} as const;

export type DeployStageExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

/** Extract a human-readable message from an unknown thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** The operation a failure occurred under (drives the user-facing wording). */
export type DeployOperation = "deploy" | "upgrade";

/** Which stage of deploy/upgrade failed (drives the exit code). */
export type DeployStage = "invalid-input" | "build" | "onchain";

/**
 * Map a failed deploy/upgrade stage to a user-facing message and the matching
 * process exit code, so a caller (CI, agent) keying off exit status can tell
 * *which stage* failed. Pure — the command layer feeds the result straight to
 * `this.error(message, { exit })`.
 *
 * - build:   no image was produced, so no on-chain tx was attempted (exit 3).
 * - onchain: the image is already built+pushed; a re-run reuses it (exit 4).
 */
export function stageFailure(
  operation: DeployOperation,
  stage: DeployStage,
  err: unknown,
): { message: string; exit: DeployStageExitCode } {
  const noun = operation === "deploy" ? "deployment" : "upgrade";
  switch (stage) {
    case "invalid-input":
      return { message: errorMessage(err), exit: EXIT_CODES.INVALID_INPUT };
    case "build":
      return {
        message: `Build/push failed (no ${noun} was attempted): ${errorMessage(err)}`,
        exit: EXIT_CODES.BUILD_FAILED,
      };
    case "onchain":
      return {
        message:
          `On-chain ${noun} failed after the image was built and pushed: ${errorMessage(err)}\n` +
          `The image is already pushed — re-running ${operation} will reuse it.`,
        exit: EXIT_CODES.ONCHAIN_FAILED,
      };
  }
}
