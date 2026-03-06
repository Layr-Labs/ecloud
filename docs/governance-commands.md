# Timelocked Upgrade Commands

EigenCloud supports two upgrade flows depending on who owns the app:

- **EOA or Safe owner** — direct upgrade via `upgradeApp`, controller acts immediately (Safe handles threshold approval externally)
- **Timelock owner** — two-step flow: schedule → wait → execute

Timelocked mode is set automatically when ownership is transferred to a Timelock deployed by `SafeTimelockFactory`.

---

## Commands

### `ecloud compute app ownership transfer`

Transfer ownership of an app to a new address.

```
ecloud compute app ownership transfer --app=<id> --to=<address>
```

| Flag | Required | Description |
|------|----------|-------------|
| `--app` | yes | App ID or name |
| `--to` | yes | New owner address |

If `--to` is a Timelock deployed by `SafeTimelockFactory`, **timelocked mode is enabled automatically** and direct upgrades are blocked. Transferring to a Safe or EOA does not enable timelocked mode.

**Examples:**

```sh
# Transfer to another EOA — no governance change
ecloud compute app ownership transfer \
  --app=0xAbc...123 \
  --to=0xDef...456

# Transfer to a Timelock — timelocked mode enabled
ecloud compute app ownership transfer \
  --app=0xAbc...123 \
  --to=0xTimelock...789
```

---

### `ecloud compute app upgrade schedule`

Schedule an upgrade for a timelocked app. Builds the image and commits a hash on-chain. The controller takes no action until `execute` is called after the delay.

```
ecloud compute app upgrade schedule --app=<id> --after=<delay> [build flags]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--app` | yes | App ID or name |
| `--after` | yes | Delay before upgrade can execute: `30s`, `5m`, `2h`, `1d` |
| `--image-ref` | no | Image reference pointing to registry |
| `--dockerfile` | no | Path to Dockerfile (alternative to `--image-ref`) |
| `--env-file` | no | Environment file (default: `.env`) |
| `--instance-type` | no | Machine instance type |
| `--log-visibility` | no | `public`, `private`, or `off` |
| `--resource-usage-monitoring` | no | `enable` or `disable` |

**Example:**

```sh
ecloud compute app upgrade schedule \
  --app=0xAbc...123 \
  --after=2h \
  --image-ref=myrepo/myapp:v2 \
  --env-file=.env.prod \
  --instance-type=g1-standard-4t \
  --log-visibility=public
```

```
App:         0xAbc...123
Delay:       2h (executable after 3/7/2026, 4:00:00 PM)
Image:       myrepo/myapp:v2

✅ Upgrade scheduled (tx: 0x...)

Executable after: 3/7/2026, 4:00:00 PM
Run to execute:   ecloud compute app upgrade execute --app=0xAbc...123
```

The `AppUpgradeScheduled` event is emitted on-chain. Multi-sig participants can review the pending upgrade during the delay window.

---

### `ecloud compute app upgrade execute`

Execute a previously scheduled upgrade once the delay has elapsed. Must be called with the **same build inputs** used in `schedule` — the release is reconstructed and its hash is verified against the on-chain commitment.

```
ecloud compute app upgrade execute --app=<id> [same build flags as schedule]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--app` | yes | App ID or name |
| `--image-ref` | no | Must match what was used in `schedule` |
| `--dockerfile` | no | Must match what was used in `schedule` |
| `--env-file` | no | Must match what was used in `schedule` |
| `--instance-type` | no | Must match what was used in `schedule` |
| `--log-visibility` | no | Must match what was used in `schedule` |
| `--resource-usage-monitoring` | no | Must match what was used in `schedule` |

**Example:**

```sh
ecloud compute app upgrade execute \
  --app=0xAbc...123 \
  --image-ref=myrepo/myapp:v2 \
  --env-file=.env.prod \
  --instance-type=g1-standard-4t \
  --log-visibility=public
```

```
Scheduled upgrade is ready. Proceeding with execution...
Note: build inputs must exactly match what was used in 'upgrade schedule'.

✅ App upgraded successfully (id: 0xAbc...123, image: myrepo/myapp:v2)

View your app: https://app.eigencloud.xyz/apps/0xAbc...123
```

**Error cases:**

```
# Delay not elapsed
✗  Upgrade is not ready yet. Executable after 3/7/2026, 4:00:00 PM (6847s remaining).

# No scheduled upgrade
✗  No upgrade is scheduled for this app. Run 'ecloud compute app upgrade schedule' first.

# Release mismatch (wrong inputs)
✗  contract error: ReleaseMismatch
```

---

### `ecloud compute app upgrade` (unchanged for EOA apps)

Direct upgrade — unchanged behavior for non-governed apps.

```
ecloud compute app upgrade --app=<id> [build flags]
```

If called on a timelocked app:

```
✗  App 0xAbc...123 is timelocked (Timelock owner).
   Use the two-step timelocked flow instead:
     ecloud compute app upgrade schedule --app=0xAbc...123 --after=<delay>
     ecloud compute app upgrade execute  --app=0xAbc...123
```

---

## Flow summary

```
EOA or Safe-owned app
──────────────────────
ecloud compute app upgrade
  └─ upgradeApp() on-chain
  └─ AppUpgraded event → controller acts immediately
  (Safe handles multi-sig threshold externally before calling this)

Timelock-owned app
───────────────────
ecloud compute app upgrade schedule --after=2h
  └─ scheduleUpgrade() on-chain
  └─ AppUpgradeScheduled event (no controller action)
  └─ [2h delay — participants can review or cancel]

ecloud compute app upgrade execute
  └─ executeUpgrade() on-chain (verifies hash, checks delay)
  └─ AppUpgraded event → controller acts
```

---

## Ownership transfer flow

```
ecloud compute app ownership transfer --app=<id> --to=<timelock-address>
  └─ transferOwnership() on-chain
  └─ SafeTimelockFactory.isTimelock(newOwner) → true → timelocked = true
  └─ AppOwnershipTransferred event
  └─ direct upgradeApp() now blocked for this app

ecloud compute app ownership transfer --app=<id> --to=<safe-address>
  └─ transferOwnership() on-chain
  └─ SafeTimelockFactory.isTimelock(newOwner) → false → timelocked = false
  └─ AppOwnershipTransferred event
  └─ direct upgradeApp() still available (Safe handles threshold externally)
```
