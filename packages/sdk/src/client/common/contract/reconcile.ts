/**
 * Release-digest reconciliation.
 *
 * After an upgrade tx lands and watchUpgrade returns (which keys off app
 * STATUS, served from the coordinator DB), the release DIGEST is served from a
 * separate Ponder indexer (GraphQL) that lags. This polls getApp until the
 * reported release digest matches the digest we just deployed, so callers never
 * read the stale pre-upgrade digest. It never throws on timeout — the caller
 * decides how to surface a not-yet-propagated result.
 */
import type { Address } from "viem";
import type { UserApiClient } from "../utils/userapi";

export interface ReconcileReleaseDigestOptions {
  /** Poll cadence. Default 3000ms. */
  intervalMs?: number;
  /** Max wall-clock before giving up (not an error). Default 45000ms. */
  timeoutMs?: number;
}

export interface ReconcileResult {
  matched: boolean;
  /** The most recent observed digest (raw, un-normalized), if any. */
  lastDigest?: string;
  elapsedMs: number;
}

const DEFAULT_INTERVAL_MS = 3000;
const DEFAULT_TIMEOUT_MS = 45000;

/** Normalize a digest for comparison: strip `sha256:`/`0x`, lowercase. */
export function normalizeDigest(digest: string | undefined): string {
  if (!digest) return "";
  return digest.trim().toLowerCase().replace(/^sha256:/, "").replace(/^0x/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll until releases[0].imageDigest matches expectedDigest (normalized) or the
 * timeout elapses. Read failures are treated as a non-match and retried.
 *
 * releases[0] is the newest: both backends return releases newest-first.
 */
export async function reconcileReleaseDigest(
  userApiClient: UserApiClient,
  appId: string,
  expectedDigest: string,
  opts?: ReconcileReleaseDigestOptions,
): Promise<ReconcileResult> {
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const target = normalizeDigest(expectedDigest);
  const startMs = Date.now();
  let lastDigest: string | undefined;

  // Nothing to reconcile against — return immediately rather than burning the
  // full timeout budget polling for a target that can never match.
  if (!target) {
    return { matched: false, lastDigest: undefined, elapsedMs: 0 };
  }

  while (true) {
    try {
      const app = await userApiClient.getApp(appId as Address);
      lastDigest = app.releases?.[0]?.imageDigest;
      if (target && normalizeDigest(lastDigest) === target) {
        return { matched: true, lastDigest, elapsedMs: Date.now() - startMs };
      }
    } catch (error) {
      // Transient read failure — treat as non-match and retry within budget.
      // Logged at debug so a persistently-failing indexer is distinguishable
      // from slow propagation.
      console.debug?.("reconcileReleaseDigest: getApp read failed, retrying:", error);
    }

    if (Date.now() - startMs >= timeoutMs) {
      return { matched: false, lastDigest, elapsedMs: Date.now() - startMs };
    }
    await sleep(intervalMs);
  }
}
