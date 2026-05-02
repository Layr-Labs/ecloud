# Tech Debt

Tracked items from bugs, code reviews, and UX gaps that should be revisited
but don't block current work.

---

## CLI `compute app upgrade` / `stop` / etc. show stale on-chain status instead of current runtime status

**Source:** Production observation, 2026-05-02.

### Symptom

`ecloud compute app upgrade` presents a picker like:

```
? Select app: sample-eigencompute-app (sepolia:0x297E26c626372a6333fD1d339Ef9854Afc49609f) - Started
```

The `- Started` suffix is misleading. For the app above:

- `ecloud compute app list` reported `Status: Created` (never deployed, no
  instance, no IP).
- Picker said `Started` at the same moment.

Both come from the same CLI session against the same backend, seconds apart.
A user who sees "Started" in the picker reasonably assumes the app is running
and picks it to `stop` or `upgrade`, then hits errors downstream because the
app has never been deployed.

### Root cause

Two different status vocabularies wired to two different sources:

1. **`compute app list`** reads status from the ecloud-platform / compute-tee
   API response, which is the runtime/DB status. Possible values include
   `Created`, `Deploying`, `Running`, `Stopped`, `Suspended`, `Terminated`,
   `Failed`, `Upgrading`, etc.
2. **The app picker** (used by `upgrade`, `stop`, `start`, `info`, `logs`,
   `releases`, `set profile for`) reads status directly from the
   `AppController` contract's `AppConfig.status` field via
   `appController.getAppConfigs(addresses)`. That enum only defines four
   non-zero values:

   | Value | Meaning (on-chain)             |
   | ----- | ------------------------------ |
   | `1`   | Started                        |
   | `2`   | Stopped                        |
   | `3`   | Terminated                     |
   | `4`   | Suspended                      |

   The contract has no `Created` state — a freshly-created app with no
   release yet still reports `AppConfig.status == 1` because the contract
   initializes it that way on `createApp`, long before any runtime deploy
   has happened.

`packages/cli/src/utils/prompts.ts:1250` appends
`getContractStatusString(status)` to each picker row, so any freshly-created
app is labeled `Started` regardless of whether it has ever been deployed.

### Fix sketch

Pick one. Option A is the cheapest.

- **A. Enrich the picker with runtime status from the same `/info` or
  `/apps/:id` response the `list` command uses.** Fall back to the contract
  status string only when the runtime call fails. Keeps the picker fast
  (single batched call) and makes it consistent with `list` + `info`. ~15
  lines in `getAppIDInteractive`-adjacent code, plus a request to whichever
  endpoint backs `list`.
- **B. Special-case "has a release" in the picker.** If
  `AppConfig.latestReleaseTimestamp == 0` (or the equivalent "no release
  ever published" sentinel the contract exposes), render the status as
  `Created` instead of `Started`. Narrower change but leaks contract
  semantics up to the user; doesn't fix the reverse case (app is
  `Terminated` at runtime but contract still says `Stopped`).
- **C. Hide status from the picker entirely.** Simplest, but loses
  information that *is* useful when it's accurate (e.g., distinguishing
  `Started` vs `Stopped` when deciding what to pass to `start` / `stop`).

Recommended: A. The `list` path already successfully hits the API — reuse
that same call.

### Scope

`packages/cli/src/utils/prompts.ts` (`getAppIDInteractive` and
`getContractStatusString` call sites around lines 1217-1295). No other
files need to change for option A; the ecloud-platform / compute-tee API
already exposes the richer status.

### Priority

Low — no functional bug, picker still sorts sensibly and the downstream
`upgrade` command works. But it's an actively misleading UX string, and any
new user seeing "Started" on an app that has never been deployed will waste
time trying to stop something that isn't running.
