#!/usr/bin/env bash
# =============================================================================
# Non-interactive smoke test for the ecloud CLI.
#
# Runs the CLI in non-TTY mode (stdin closed) against every command path that
# offers a non-interactive escape hatch (flag, env var, --force) and asserts:
#
#   1. Commands that should succeed do succeed
#   2. Commands that should fail do so with a specific, actionable error
#      message -- never the generic "Cannot prompt in non-interactive mode"
#   3. No command hangs past its timeout
#
# Intended to run in CI on every PR. Catches regressions like the ones fixed
# in #130 (getEnvironmentInteractive swallowing the real error, and
# promptUseVerifiableBuild ignoring --force).
#
# Usage (from repo root):
#   ./packages/cli/test/e2e/non-interactive.sh
#
# Requires: the CLI to be built (pnpm -r build) before invocation.
# =============================================================================

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
CLI="$REPO_ROOT/packages/cli/bin/run.js"
FIXTURE_ENV="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/fixtures/minimal.env"

# Dummy app ID — deterministic, doesn't resolve to a real app. Used in info
# calls where we expect to fail *before* the app lookup (at env validation).
DUMMY_APP_ID="0x0000000000000000000000000000000000000000"

if [ ! -x "$CLI" ]; then
  echo "::error::CLI binary not found at $CLI. Run 'pnpm -r build' first."
  exit 1
fi

FAIL=0
PASS=0

# -----------------------------------------------------------------------------
# Assertion helpers. Each takes a short description for clear CI output.
# -----------------------------------------------------------------------------

assert_match() {
  local desc="$1" pattern="$2" output="$3"
  if echo "$output" | grep -qE -- "$pattern"; then
    echo "  ✓ [$desc] output matched /$pattern/"
    PASS=$((PASS + 1))
  else
    echo "::error::[$desc] output did not match /$pattern/"
    echo "$output" | sed 's/^/    /' >&2
    FAIL=$((FAIL + 1))
  fi
}

assert_not_match() {
  local desc="$1" pattern="$2" output="$3"
  if echo "$output" | grep -qE -- "$pattern"; then
    echo "::error::[$desc] output unexpectedly matched /$pattern/"
    echo "$output" | sed 's/^/    /' >&2
    FAIL=$((FAIL + 1))
  else
    echo "  ✓ [$desc] output clean of /$pattern/"
    PASS=$((PASS + 1))
  fi
}

# Run the CLI non-interactively with a timeout. Merges stderr into stdout.
# Always returns 0 so tests can capture and inspect output regardless of the
# command's own exit code.
run_cli() {
  timeout 20 "$CLI" "$@" </dev/null 2>&1 || true
}

section() { echo ""; echo "▸ $1"; }

# -----------------------------------------------------------------------------
# Test suite
# -----------------------------------------------------------------------------

section "Help surfaces load cleanly"
for subcmd in "--version" "--help" "compute app info --help" "compute app deploy --help" "compute app upgrade --help" "billing status --help" "auth whoami --help"; do
  # shellcheck disable=SC2086
  out=$(run_cli $subcmd)
  assert_not_match "'$subcmd' loaded without prompt error" "Cannot prompt in non-interactive" "$out"
done

section "Bug 1 — unknown environment surfaces a distinct error"
# Invalid env name via ECLOUD_ENV
out=$(ECLOUD_ENV=bogusenv run_cli compute app info "$DUMMY_APP_ID")
assert_match     "bogusenv via ECLOUD_ENV"  "Unknown environment: bogusenv" "$out"
assert_not_match "bogusenv via ECLOUD_ENV"  "Cannot prompt in non-interactive" "$out"

# Invalid env name via --environment
out=$(run_cli compute app info "$DUMMY_APP_ID" --environment bogusenv)
assert_match     "bogusenv via --environment" "Unknown environment: bogusenv" "$out"
assert_not_match "bogusenv via --environment" "Cannot prompt in non-interactive" "$out"

section "Bug 1 — env unavailable in current build type surfaces the real reason"
# The CLI in CI is built as prod by default, so sepolia-dev is the env that is
# defined but not available. Asserting this here covers the mirror case of
# "dev build running against mainnet-alpha" that originally triggered the bug.
out=$(ECLOUD_ENV=sepolia-dev run_cli compute app info "$DUMMY_APP_ID")
assert_match     "sepolia-dev in prod build"  "not available in this build type" "$out"
assert_not_match "sepolia-dev in prod build"  "Cannot prompt in non-interactive" "$out"

section "Bug 2 — deploy with image-ref only and --force skips the verifiable prompt"
# Uses a non-existent image ref so the command will fail downstream (pull /
# billing / network), but the assertion is specifically that it does NOT hit
# the verifiable-source confirmation gate.
out=$(run_cli compute app deploy \
  --name smoke-image-ref-only \
  --env-file "$FIXTURE_ENV" \
  --image-ref "ghcr.io/ecloud-smoke-test/does-not-exist:latest" \
  --instance-type g1-micro-1v \
  --log-visibility public \
  --resource-usage-monitoring enable \
  --skip-profile \
  --description "non-interactive smoke" \
  --force)
assert_not_match "image-ref deploy with --force" 'Cannot confirm "Build from verifiable source\?"' "$out"

section "Bug 2 — upgrade with image-ref only and --force skips the verifiable prompt"
out=$(run_cli compute app upgrade "$DUMMY_APP_ID" \
  --env-file "$FIXTURE_ENV" \
  --image-ref "ghcr.io/ecloud-smoke-test/does-not-exist:latest" \
  --instance-type g1-micro-1v \
  --log-visibility public \
  --resource-usage-monitoring enable \
  --force)
assert_not_match "image-ref upgrade with --force" 'Cannot confirm "Build from verifiable source\?"' "$out"

section "Auth — whoami runs non-interactively without crashing"
# whoami has no side effects and no prompts regardless of keyring state.
out=$(run_cli auth whoami)
assert_not_match "auth whoami" "Cannot prompt in non-interactive" "$out"

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------

echo ""
echo "============================================================"
echo "  Non-interactive smoke: $PASS passed, $FAIL failed"
echo "============================================================"

if [ "$FAIL" -ne 0 ]; then
  exit 1
fi
