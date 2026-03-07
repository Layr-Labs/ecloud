# EigenCloud Governance Demo Scenarios

Four end-to-end flows demonstrating timelocked app upgrades across identity types.

> **Setup**: build once before running any scenario.
> ```
> cd packages/cli && pnpm run build:dev
> alias ecloud="node $(pwd)/bin/run.js"
> ```

---

## Scenario 1 — EOA: create, deploy, direct upgrade

A plain wallet (EOA) can deploy and upgrade apps directly with no delays or approvals.

```bash
# 1. Login as EOA
ecloud auth login
# → select "your wallet (EOA)"

# 2. Deploy an app
ecloud compute app deploy --image-ref myrepo/myapp:v1

# 3. Upgrade directly (no schedule needed)
ecloud compute app upgrade --image-ref myrepo/myapp:v2

# 4. Check app info — owner shown as EOA
ecloud compute app info
```

---

## Scenario 2 — EOA → Timelock(EOA): schedule and execute an upgrade

Wrap the EOA in a Timelock so that upgrades require a time delay before they can execute.

```bash
# 1. (Still logged in as EOA from Scenario 1, or re-login)
ecloud auth login
# → select "your wallet (EOA)"

# 2. Upgrade the identity to Timelock wrapping this EOA
ecloud auth generate
# → select "Timelock"
# → enter proposer: 0x1234567890abcdef1234567890abcdef12345678
# → enter delay:    30s    ← short delay for demo

# 3. Transfer app ownership to the Timelock
ecloud compute app ownership transfer --to <timelock-address>
# → timelocked mode enabled automatically

# 4. Login as the new Timelock identity
ecloud auth login
# → select "Timelock, 24h delay"

# 5. Try a direct upgrade — rejected
ecloud compute app upgrade --image-ref myrepo/myapp:v3
# → Error: TimelockRequired — use schedule/execute flow

# 6. Schedule the upgrade with a short delay
ecloud compute app upgrade schedule --after=30s --image-ref myrepo/myapp:v3
# → ✅ Upgrade scheduled
# → Executable after: <timestamp>

# 7. Attempt to execute immediately — not ready yet
ecloud compute app upgrade execute --image-ref myrepo/myapp:v3
# → Error: Upgrade is not ready yet. Executable after ... (28s remaining)

# 8. Wait for the delay to elapse, then execute
sleep 30
ecloud compute app upgrade execute --image-ref myrepo/myapp:v3
# → ✅ App upgraded successfully
```

---

## Scenario 3 — Safe: deploy, upgrade via Safe approval

A Gnosis Safe (multi-sig) can deploy and upgrade apps. Each transaction is proposed to the Safe and requires threshold approval from signers.

```bash
# 1. Login as Safe
ecloud auth login
# → select "3/5 Safe"

# 2. Deploy an app — proposes to Safe
ecloud compute app deploy --image-ref myrepo/myapp:v1
# → Transaction proposed to Safe (0x9999...aaaa)
# → View and sign at: https://app.safe.global/...
# → (Simulating Safe approval...)
# → ✅ App deployed successfully

# 3. Upgrade — also proposes to Safe
ecloud compute app upgrade --image-ref myrepo/myapp:v2
# → Transaction proposed to Safe (0x9999...aaaa)
# → View and sign at: https://app.safe.global/...
# → ✅ App upgraded successfully

# 4. Grant a role — proposes to Safe
ecloud compute team grant 0xDEAD...
# → select DEVELOPER
# → Transaction proposed to Safe...
# → ✅ Role DEVELOPER granted

# 5. Check app info — trust chain: Safe (3/5)
ecloud compute app info
```

---

## Scenario 4 — Safe → Timelock(Safe): schedule and execute via Safe

Wrap the Safe in a Timelock for an extra time-delay layer. Both the schedule and execute steps must be approved by the Safe before they take effect.

```bash
# 1. Still logged in as Safe (or re-login)
ecloud auth login
# → select "3/5 Safe"

# 2. Deploy a Timelock that wraps the Safe
ecloud auth generate
# → select "Timelock"
# → enter proposer: 0x9999aaaa9999aaaa9999aaaa9999aaaa9999aaaa  (Safe address)
# → enter delay:    30s

# 3. Transfer app ownership to the Timelock
ecloud compute app ownership transfer --to <timelock-address>
# → timelocked mode enabled

# 4. Login as Timelock(Safe) identity
ecloud auth login
# → select "Timelock, 24h delay (via 2/3 Safe)"

# 5. Try a direct upgrade — rejected
ecloud compute app upgrade --image-ref myrepo/myapp:v3
# → Error: TimelockRequired — use schedule/execute flow

# 6. Schedule the upgrade — proposed to Safe first
ecloud compute app upgrade schedule --after=30s --image-ref myrepo/myapp:v3
# → Building image...
# → Transaction proposed to Safe for scheduling. (0x9999...aaaa)
# → View and sign at: https://app.safe.global/...
# → (Simulating Safe approval...)
# → ✅ Upgrade scheduled

# 7. Attempt to execute immediately — not ready
ecloud compute app upgrade execute --image-ref myrepo/myapp:v3
# → Error: Upgrade is not ready yet. (28s remaining)

# 8. Wait, then execute — also proposed to Safe
sleep 30
ecloud compute app upgrade execute --image-ref myrepo/myapp:v3
# → Transaction proposed to Safe for execution. (0x9999...aaaa)
# → View and sign at: https://app.safe.global/...
# → (Simulating Safe approval...)
# → ✅ App upgraded successfully

# 9. Check app info — trust chain: Timelock (30s) → Safe (3/5)
ecloud compute app info
```

---

## Error scenario overrides

Force specific error paths without waiting, using `ECLOUD_DEMO_SCENARIO`:

| Value | Effect |
|---|---|
| `not-ready` | `upgrade execute` always returns "not ready" error |
| `mismatch` | `upgrade execute` returns ReleaseMismatch error |
| `timelocked` | `upgrade` (direct) returns TimelockRequired error |

```bash
ECLOUD_DEMO_SCENARIO=not-ready ecloud compute app upgrade execute
ECLOUD_DEMO_SCENARIO=mismatch  ecloud compute app upgrade execute
ECLOUD_DEMO_SCENARIO=timelocked ecloud compute app upgrade
```
