# Identity × Command Matrix

## Running the demo

The CLI ships with a stateful demo mode that simulates all governance flows without hitting real contracts.

**Setup:**
```bash
# from the ecloud repo root
alias ecloud="node packages/cli/bin/run.js"

cd packages/cli && npm run build
```

**Start demo mode** (no flags needed — demo is active by default):
```bash
ecloud auth login
```

Demo state is stored in `/tmp/ecloud-demo-state.json` and persists across commands. To reset:
```bash
rm /tmp/ecloud-demo-state.json
```

**Run with real contracts** (Sepolia/mainnet):
```bash
ECLOUD_REAL_MODE=true ecloud compute app deploy --image-ref myrepo/myapp:v1
```

---

Behaviour of each CLI command per identity type.

**Identity types:**
- **EOA** — plain wallet, signs directly
- **Timelock(EOA)** — Timelock contract with an EOA as proposer/executor
- **Safe** — Gnosis Safe (multi-sig threshold)
- **Timelock(Safe)** — Timelock contract with a Safe as proposer/executor
- **PAUSER** — EOA (or Safe) granted PAUSER role by an ADMIN; can stop apps only
- **DEVELOPER** — EOA granted DEVELOPER role by an ADMIN; read-only + metadata ops

## Identity migration

How accounts can be created and upgraded to stronger security models.

```
                    ecloud auth new → Safe
                   ┌─────────────────────────────────────────┐
                   │                                         │
                   ▼                                         │
  ecloud auth new → EOA                                    Safe
         │                                                   │
         │  ecloud auth new                                  │  ecloud auth new
         │  → Timelock (EOA proposer)                        │  → Timelock (Safe proposer)
         │                                                   │    OR
         ▼                                                   │  ecloud auth new → Safe
  Timelock(EOA)                                              │  → "Add timelock delay?" → yes
                                                             ▼
                                                      Timelock(Safe)
```

**App ownership migration** — once you have a Timelock identity, transfer the app:

```
  App owned by EOA
        │
        │  ecloud compute app ownership transfer --to=<safe-addr>
        ▼
  App owned by Safe  ──────────────────────────────────────────────────────────────────┐
        │                                                                              │
        │  ecloud compute app ownership transfer --to=<timelock-addr>                  │ upgrades now require
        ▼                                                                              │ Safe propose
  App owned by Timelock(Safe)  ─────── upgrades now require schedule + execute + Safe propose
```

**Upgrade behaviour changes with each step:**

| App owner | Upgrade command | Flow |
|---|---|---|
| EOA | `ecloud compute app upgrade` | direct |
| Safe | `ecloud compute app upgrade` | Safe propose → approved |
| Timelock(Safe) | `ecloud compute app upgrade schedule` + `execute` | Safe propose → delay → Safe propose |

---

**Legend:**
- `direct` — CLI signs and submits immediately, no extra steps
- `Safe propose` — CLI proposes tx to Safe; threshold of signers must approve at app.safe.global
- `schedule + execute` — two-step timelocked flow; delay must elapse between steps
- `schedule + execute + Safe propose` — same two-step flow, but each step also requires Safe approval
- `❌ error` — command is blocked; CLI shows a descriptive error with the correct alternative
- `—` — not applicable / not shown

---

## Auth

| Command | EOA | Timelock(EOA) | Safe | Timelock(Safe) | PAUSER | DEVELOPER |
|---|---|---|---|---|---|---|
| `ecloud auth login` | select identity | select identity | select identity | select identity | select identity | select identity |
| `ecloud auth new` | create EOA key | create Timelock | create Safe | create Timelock | — | — |

---

## App lifecycle

| Command | EOA | Timelock(EOA) | Safe | Timelock(Safe) | PAUSER | DEVELOPER |
|---|---|---|---|---|---|---|
| `ecloud compute app deploy` | direct | direct | Safe propose | Safe propose | ❌ no permission | ❌ no permission |
| `ecloud compute app upgrade` | direct | ❌ TimelockRequired | Safe propose | ❌ TimelockRequired | ❌ no permission | ❌ no permission |
| `ecloud compute app start` | direct | direct | Safe propose | Safe propose | ❌ no permission | ❌ no permission |
| `ecloud compute app stop` | direct | direct | Safe propose | Safe propose | direct | ❌ no permission |
| `ecloud compute app terminate` | direct | direct | Safe propose | Safe propose | ❌ no permission | ❌ no permission |

---

## App metadata & observability

| Command | EOA | Timelock(EOA) | Safe | Timelock(Safe) | PAUSER | DEVELOPER |
|---|---|---|---|---|---|---|
| `ecloud compute app profile set` | direct | direct | direct | direct | ❌ no permission | direct |
| `ecloud compute app info` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `ecloud compute app logs` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `ecloud compute app list` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `ecloud compute app releases` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## Timelocked upgrade flow

Only available when identity is `Timelock(EOA)` or `Timelock(Safe)`. Blocked for all other identities.

| Command | EOA | Timelock(EOA) | Safe | Timelock(Safe) | PAUSER | DEVELOPER |
|---|---|---|---|---|---|---|
| `ecloud compute app upgrade schedule <app-id> --after=<delay>` | ❌ not timelocked | ✅ schedules | ❌ not timelocked | ✅ schedules + Safe propose | ❌ no permission | ❌ no permission |
| `ecloud compute app upgrade execute <app-id>` | ❌ not timelocked | ✅ executes after delay | ❌ not timelocked | ✅ executes + Safe propose | ❌ no permission | ❌ no permission |
| `ecloud demo fastforward` | — | ✅ skips delay | — | ✅ skips delay | — | — |

---

## App ownership

| Command | EOA | Timelock(EOA) | Safe | Timelock(Safe) | PAUSER | DEVELOPER |
|---|---|---|---|---|---|---|
| `ecloud compute app ownership transfer --to=<addr>` | direct | direct | Safe propose | Safe propose | ❌ no permission | ❌ no permission |

> Transferring to a Timelock address automatically enables timelocked mode on the app.

---

## Team roles

| Command | EOA | Timelock(EOA) | Safe | Timelock(Safe) | PAUSER | DEVELOPER |
|---|---|---|---|---|---|---|
| `ecloud compute team grant <addr>` | direct | direct | Safe propose | Safe propose | ❌ no permission | ❌ no permission |
| `ecloud compute team revoke <addr>` | direct | direct | Safe propose | Safe propose | ❌ no permission | ❌ no permission |
| `ecloud compute team list` | — | — | ✅ shows roles | ✅ shows roles | — | — |

> Team roles (ADMIN, PAUSER, DEVELOPER) are only shown in `ecloud compute app info` and `ecloud compute team list` when the app owner is a Safe or Timelock(Safe).
> ADMIN is the Safe or Timelock address — never an individual EOA in a Safe-governed app.

#### Why you should never grant ADMIN to an EOA in a Safe-governed app

AppController's admin check is purely role-based: it verifies `msg.sender` holds `keccak256(owner, ADMIN)`. It does **not** enforce that the caller went through Safe's threshold signing.

This means: if you grant ADMIN to an EOA, that EOA can call `upgradeApp`, `terminateApp`, `startApp`, etc. **directly** — bypassing the Safe entirely. The entire point of Safe ownership (threshold approval, no single point of failure) is defeated.

**The correct model for Safe-owned apps:**

| Role | Holder | How ops are authorized |
|---|---|---|
| ADMIN | Safe (or Timelock) only | Requires Safe threshold signature |
| PAUSER | Individual EOA | Direct — intentional, for emergency stop without delay |
| DEVELOPER | Individual EOA | Direct — limited to metadata and observability |

The contract does not hard-enforce this convention today — it is an operational rule. Granting ADMIN to an EOA is technically possible but breaks the security model. Since granting any role requires being ADMIN, and Safe is the sole ADMIN, any such grant would itself require Safe approval — making it a deliberate, visible act rather than an accident.

---

## App info

| Field shown | EOA | Timelock(EOA) | Safe | Timelock(Safe) | PAUSER | DEVELOPER |
|---|---|---|---|---|---|---|
| Owner | ✅ | ✅ with delay label | ✅ | ✅ with delay + Safe label | ✅ | ✅ |
| Status / Image / Instance | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Team Roles section | — | — | ✅ | ✅ | — | — |

---

## Full upgrade flows by identity

### EOA
```
ecloud compute app deploy --image-ref myrepo/myapp:v1
ecloud compute app upgrade --image-ref myrepo/myapp:v2
```

### Timelock(EOA)
```
ecloud compute app deploy --image-ref myrepo/myapp:v1
ecloud compute app upgrade schedule <app-id> --after=24h
# wait for delay (or: ecloud demo fastforward)
ecloud compute app upgrade execute <app-id>
```

### Safe
```
ecloud compute app deploy          → Safe propose → approved → done
ecloud compute app upgrade         → Safe propose → approved → done
ecloud compute team grant <addr>   → Safe propose → approved → done
ecloud compute app stop            → Safe propose → approved → done
```

### Timelock(Safe)
```
ecloud compute app deploy                              → Safe propose → approved → done
ecloud compute app upgrade schedule <app-id> --after=24h → Safe propose → approved → scheduled
# wait for delay (or: ecloud demo fastforward)
ecloud compute app upgrade execute <app-id>            → Safe propose → approved → done
ecloud compute team grant <addr>                       → Safe propose → approved → done
ecloud compute app stop                                → Safe propose → approved → done
```

### Safe → Timelock(Safe) transition (adding upgrade delay)
```
# 1. Start as Safe, deploy the app
ecloud auth login                              → select 3/5 Safe
ecloud compute app deploy --image-ref myrepo/myapp:v1
                                               → Safe propose → approved → done

# 2. Transfer ownership to a Timelock (adds upgrade delay on top of Safe)
ecloud compute app ownership transfer --to=<timelock-addr>
                                               → Safe propose → approved → done
                                               → Timelocked mode enabled

# 3. Switch identity to the Timelock
ecloud auth login                              → select Timelock (24h delay) via 2/3 Safe

# 4. Direct upgrade is now blocked
ecloud compute app upgrade                     → ❌ TimelockRequired
                                               →   use: ecloud compute app upgrade schedule <app-id> --after=<delay>
                                               →         ecloud compute app upgrade execute  <app-id>

# 5. Use the two-step timelocked flow
ecloud compute app upgrade schedule <app-id> --after=24h
                                               → Safe propose → approved → scheduled
# wait for delay (or: ecloud demo fastforward)
ecloud compute app upgrade execute <app-id>    → Safe propose → approved → done
```

---

### PAUSER role (granted by Safe)
```
# Admin grants PAUSER role to 0x5678...
ecloud compute team grant 0x5678567856785678567856785678567856785678 → Safe propose → approved → done

# PAUSER acts directly, no Safe needed
ecloud auth login                   → select PAUSER identity (0x5678...5678)
ecloud compute app stop             → direct
```

### DEVELOPER role (granted by Admin)
```
# Admin grants DEVELOPER role to 0x9999...
ecloud compute team grant 0x9999... → (direct | Safe propose) → done

# DEVELOPER can view info, update metadata, view logs; cannot perform admin ops
ecloud auth login                   → select DEVELOPER identity (0x9999...)
ecloud compute app info             → shows status, image, instance type
ecloud compute app logs             → stream app logs
ecloud compute app profile set      → update name, website, description, image
ecloud compute app upgrade          → ❌ no permission
ecloud compute app stop             → ❌ no permission
```
