# CLI end-to-end tests

These are black-box smoke tests that invoke the built CLI binary the same way
CI and users do — via a child process with stdin closed. They complement the
vitest unit tests in `packages/cli/src/**/__tests__/` by catching regressions
that only surface once the full oclif command tree is loaded.

## `non-interactive.sh`

Non-TTY smoke test. Every command path that offers a non-interactive escape
hatch (`--force`, explicit flag, env var) is invoked with `stdin </dev/null`
and asserted to either:

- succeed, or
- fail with a specific, actionable error message

The assertion that catches the most regressions is that commands **never**
emit the generic `Cannot prompt in non-interactive mode` error when enough
information has been provided via flags or env vars. That was the common
shape of the regressions fixed in #130.

### Run locally

```bash
pnpm -r build                                   # build SDK + CLI
./packages/cli/test/e2e/non-interactive.sh
```

Expected runtime: ~10 seconds. Exits non-zero on any failed assertion.

### Add a new assertion

Every assertion follows the same shape:

```bash
out=$(run_cli compute app info "$DUMMY_APP_ID" --environment bogusenv)
assert_match     "description" "expected pattern"     "$out"
assert_not_match "description" "unwanted pattern"     "$out"
```

`run_cli` always returns zero so you can capture output regardless of the
command's own exit code — assertions are pattern-based on the merged
stdout + stderr.

Prefer asserting both a positive match (the specific expected error) AND
a negative match (no `"Cannot prompt in non-interactive mode"`) when
testing error paths — the negative check is what catches the class of
regressions that triggered this script.

## Future tiers

This script is Tier 1 of a planned three-tier validation stack:

| Tier | What | When |
|---|---|---|
| 1 | This file — non-TTY smoke, no on-chain writes | every PR |
| 2 | Full Sepolia deploy lifecycle on a dedicated funded wallet | nightly / pre-release |
| 3 | Deploy-agent skill runbook executed end-to-end | pre-release validation |

Tier 2 and Tier 3 need several upstream fixes first (`billing subscribe`
non-interactive mode, `auth gen --store` keyring-replace flag, etc).
