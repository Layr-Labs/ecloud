import type { Address } from "viem";
import { getActiveIdentity, getIdentities } from "./globalConfig";

/**
 * Figure out which on-chain identities the CLI should declare to UserAPI via
 * X-eigenx-identity. Rules:
 *
 *   - Only non-EOA identities (Safe, Timelock, Timelock(Safe)) are returned.
 *     The EOA has no independent identity claim — the server recovers it from
 *     the auth signature.
 *   - For commands that act on a single app the "active" identity is the one
 *     to declare; use `identityForActiveContext` and pass the result.
 *   - For commands that enumerate apps across every identity the caller owns
 *     (e.g., `app list`), use `identityForAllContexts` — all non-EOA identities
 *     for the current environment are returned so the server can authorize
 *     across them in one request.
 */

/**
 * The active identity for this environment, as a header-friendly list.
 * Returns [] if the active identity is the EOA or if no identity is set.
 */
export function identityForActiveContext(environment: string): Address[] {
  const active = getActiveIdentity(environment);
  if (!active || active.type === "eoa") return [];
  return [active.address as Address];
}

/**
 * Every non-EOA identity the caller has stored for this environment.
 * Returns [] if only EOA identities exist.
 */
export function identityForAllContexts(environment: string): Address[] {
  return getIdentities()
    .filter((id) => id.type !== "eoa" && id.environment === environment)
    .map((id) => id.address as Address);
}
