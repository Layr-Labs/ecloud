# Identity × Command Matrix

Behaviour of each CLI command per identity type.

**Identity types:**
- **EOA** — plain wallet, signs directly
- **Timelock(EOA)** — Timelock contract with an EOA as proposer/executor
- **Safe** — Gnosis Safe (multi-sig threshold)
- **Timelock(Safe)** — Timelock contract with a Safe as proposer/executor
- **PAUSER** — EOA (or Safe) granted PAUSER role by an ADMIN; can stop apps only
- **DEVELOPER** — EOA granted DEVELOPER role by an ADMIN; read-only + metadata ops

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

### PAUSER role (granted by Safe)
```
# Admin grants PAUSER role to 0x5678...
ecloud compute team grant 0x5678... → Safe propose → approved → done

# PAUSER acts directly, no Safe needed
ecloud auth login                   → select PAUSER identity (0x5678...)
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
