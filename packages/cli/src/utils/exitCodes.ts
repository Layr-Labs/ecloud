/**
 * Distinct process exit codes for deploy/upgrade so a caller (CI, agent) keying
 * off exit status can tell *which stage* failed.
 *
 * A ~7-minute build that succeeds and then fails on-chain must be
 * distinguishable from a build that never produced an image.
 *
 *   1  generic / unclassified error (oclif default)
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
