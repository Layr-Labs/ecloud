# Auth Flow Map

Complete map of all authentication and identity transitions in the ecloud CLI.

## Storage Layers

Two independent storage systems:

| Layer | Location | What it stores |
|---|---|---|
| **Keyring** | OS keyring (macOS Keychain / Linux Secret Service) | One private key — the master signing credential |
| **Config** | `~/.config/ecloud/config.yaml` | Identities (EOA, Safe, Timelock) + active identity per environment |

## Concepts

- **Signing key** — one private key stored in OS keyring. Master credential. All identities are controlled by this key.
- **Identity** — an on-chain address the signing key can operate from: EOA, Safe, or Timelock.
- **Active identity** — the identity used for commands in a given environment. One per environment.
- **Roles** (PAUSER, DEVELOPER) — permissions on a specific app, not identity types. Checked at the app level, not the identity level.

## State Transitions

Every auth command and exactly what it changes:

| Command | Keyring | Config (identities) | Config (active) |
|---|---|---|---|
| `auth generate` (store=yes) | writes new key | replaces all with EOA | sets EOA active for all envs |
| `auth generate` (store=no) | no change | no change | no change |
| `auth login` | writes imported key | replaces all with EOA + discovered | sets EOA active |
| `auth logout` | deletes key | clears all | clears all |
| `auth identity new` (Safe) | no change | adds Safe | sets Safe active |
| `auth identity new` (Timelock) | no change | adds Timelock | sets Timelock active |
| `auth identity list` | no change | no change | no change |
| `auth identity select` | no change | no change | sets selected active |

## Commands

| Command | Purpose |
|---|---|
| `ecloud auth generate` | Generate a new private key and store in OS keyring |
| `ecloud auth login` | Import an existing private key into OS keyring |
| `ecloud auth logout` | Remove signing key and all identities |
| `ecloud auth whoami` | Show signing key, identities, and active identity |
| `ecloud auth identity new` | Create a new identity (Safe or Timelock) |
| `ecloud auth identity list` | Show all stored identities |
| `ecloud auth identity select` | Switch active identity for an environment |

---

## `ecloud auth generate`

Generate a new private key. Optionally store in OS keyring.

```
ecloud auth generate
│
├── ? Store this key in your OS keyring? (Y/n)
│
├── No
│   │
│   ├── Generate new key
│   ├── Show key in pager (address + private key)
│   ├── "Key not stored in keyring."
│   └── END — key exists only in user's memory/clipboard
│
└── Yes
    │
    ├── Check: does a signing key already exist in keyring?
    │
    ├── No existing key
    │   │
    │   ├── Generate new key
    │   ├── Show key in pager
    │   ├── Store in keyring
    │   ├── Replace all identities with new EOA
    │   ├── Set active identity for all environments
    │   └── END — ✓ new EOA identity active
    │
    └── Existing key found
        │
        ├── ⚠ Warning: "A signing key already exists."
        │   "Address: 0x..."
        │   "Replacing it will clear all current identities."
        │
        ├── ? Replace existing key? (y/N)
        │
        ├── No  → "Cancelled." → END
        │
        └── Yes
            │
            ├── Generate new key
            ├── Show key in pager
            ├── Store in keyring (replaces old)
            ├── Replace all identities with new EOA
            ├── Set active identity for all environments
            └── END — ✓ new EOA identity active, old key gone
```

---

## `ecloud auth login`

Import an existing private key. Discovers associated Timelocks and Safes on-chain.

```
ecloud auth login
│
├── Check: does a signing key already exist in keyring?
│
├── Existing key found
│   │
│   ├── ⚠ Warning: "A signing key already exists."
│   │   "Address: 0x..."
│   │   "Replacing it will clear all current identities."
│   │
│   ├── ? Replace current signing key? (y/N)
│   ├── No → "Cancelled." → END
│   └── Yes → (continue to key import below)
│
├── No existing key → (continue to key import below)
│
├── Check for legacy eigenx-cli keys
│   │
│   ├── Found legacy keys
│   │   ├── Display them
│   │   ├── ? Import one? → Yes → select which → retrieve key
│   │   └── No → prompt for manual entry
│   │
│   └── No legacy keys → prompt for manual entry
│
├── ? Enter your private key: ********
│
├── Validate key format
├── Show derived address
├── ? Store in OS keyring? → No → "Cancelled." → END
│                           → Yes ↓
│
├── Store key in keyring
├── Replace all identities with new EOA
├── Set active identity
│
├── Discover identities on-chain:
│   │
│   ├── Scan for Timelock (deterministic address via CREATE2)
│   │   ├── Found → ? Add to identities? → Yes/No
│   │   └── Not found → "No Timelock found"
│   │
│   └── Scan Safe Transaction Service for Safes owned by this EOA
│       ├── Found N Safes → for each: ? Add to identities? → Yes/No
│       └── None found → (skip)
│
├── If legacy key was imported:
│   ├── ? Delete legacy key from eigenx-cli? → Yes/No
│
└── END — ✓ key stored, identities discovered
```

---

## `ecloud auth logout`

Removes signing key from OS keyring and clears all identities.

```
ecloud auth logout
│
├── Check: key in keyring?
│   ├── No → "No key found. Nothing to remove." → END
│   └── Yes ↓
│
├── "Found stored key: Address: 0x..."
│
├── ? Remove private key from keyring? (y/N)
│   ├── No → "Cancelled." → END
│   └── Yes ↓
│
├── Remove key from keyring
├── Clear all identities
├── Clear all active identity selections
│
└── END — ✓ clean slate
```

---

## `ecloud auth whoami`

Read-only — displays current state.

```
ecloud auth whoami --environment <env>

Signing key: 0xABC...DEF  (stored credentials)
             or
Signing key: none  (run: ecloud auth generate)

Identities (<env>):
  ● EOA 0xABC...DEF              ← active
  ○ Safe 0x123...456
  ○ Timelock 0x789... (24h delay, via Safe 0x123...)

Run 'ecloud auth identity select' to switch active identity.
```

---

## `ecloud auth identity new`

Create a new identity. Requires a signing key in the keyring.

```
ecloud auth identity new
│
├── Check: signing key in keyring?
│   └── No → error: "Run 'ecloud auth generate' or 'ecloud auth login' first." → END
│
├── ? What type of identity?
│   > Gnosis Safe  (multi-sig)
│     Timelock  (for existing EOA or Safe)
│
├── Safe
│   │
│   ├── "Signing key 0x... will be included as an owner."
│   ├── ? Additional owner addresses: (comma-separated)
│   ├── ? Threshold: (e.g., 2 of 3)
│   ├── ? Add timelock delay? (y/N)
│   │
│   ├── No timelock
│   │   ├── Deploy Safe via factory (on-chain tx)
│   │   ├── Add Safe identity to config
│   │   ├── Set active identity → Safe
│   │   └── END — ✓ Safe identity active
│   │
│   └── Yes timelock
│       ├── ? Minimum delay: (e.g., "24h", "7d")
│       ├── Deploy Safe + Timelock via factory (on-chain txs)
│       ├── Add Timelock(Safe) identity to config
│       ├── Set active identity → Timelock(Safe)
│       └── END — ✓ Timelock(Safe) identity active
│
└── Timelock
    │
    ├── ? Is the proposer/executor an EOA or a Safe?
    │
    ├── EOA
    │   ├── Check: canonical Timelock exists on-chain?
    │   │   ├── Yes + in config → "Already in identities." → ? Set active? → END
    │   │   ├── Yes + not in config → ? Add to identities? → END
    │   │   └── No → deploy new Timelock ↓
    │   ├── ? Minimum delay: (e.g., "24h")
    │   ├── Deploy Timelock via factory (on-chain tx)
    │   ├── Add Timelock(EOA) identity to config
    │   ├── Set active identity → Timelock(EOA)
    │   └── END — ✓ Timelock(EOA) identity active
    │
    └── Safe
        ├── ? Safe address: 0x...
        ├── ? Minimum delay: (e.g., "24h")
        ├── Deploy Timelock via factory (on-chain tx)
        ├── Add Timelock(Safe) identity to config
        ├── Set active identity → Timelock(Safe)
        └── END — ✓ Timelock(Safe) identity active
```

---

## `ecloud auth identity list`

Read-only — shows all stored identities.

```
ecloud auth identity list --environment <env>

Identities (<env>):
  ● EOA 0xABC...DEF              ← active
  ○ Safe 0x123...456
  ○ Timelock 0x789... (24h delay, via Safe 0x123...)
```

---

## `ecloud auth identity select`

Switch active identity for an environment.

```
ecloud auth identity select --environment <env>
│
├── No identities → "Run 'ecloud auth identity new' to create one." → END
│
├── ? Select active identity for <env>:
│   ● EOA 0xABC...        ✓ active
│   ○ Safe 0xDEF...
│   ○ Timelock 0x123... (24h delay)
│
├── Selected → set as active
└── END — ✓ Active identity: <selected>
```

---

## Identity Transitions

How an account evolves from simple to secure:

```
              auth generate → EOA (signing key)
                     │
        ┌────────────┼────────────┐
        │            │            │
        ▼            ▼            ▼
  identity new → identity new → identity new →
  Timelock(EOA)  Safe           Safe + Timelock
                  │
             identity new →
             Timelock(Safe)
```

| From | To | Command |
|---|---|---|
| Nothing | EOA | `auth generate` or `auth login` |
| EOA | Timelock(EOA) | `auth identity new` → Timelock → EOA proposer |
| EOA | Safe | `auth identity new` → Safe |
| EOA | Timelock(Safe) | `auth identity new` → Safe → "Add timelock? Yes" |
| Safe | Timelock(Safe) | `auth identity new` → Timelock → Safe proposer |
| Any | Switch active | `auth identity select` |
| Any | Clean slate | `auth logout` |

---

## App Ownership Transitions

Separate from identity — this is about who owns the app on-chain:

| App owner | Upgrade flow | Command |
|---|---|---|
| EOA | direct | `ecloud compute app upgrade` |
| Safe | Safe propose → approved | `ecloud compute app upgrade` |
| Timelock(EOA) | schedule → wait → execute | `upgrade schedule` + `upgrade execute` |
| Timelock(Safe) | Safe propose → schedule → wait → Safe propose → execute | `upgrade schedule` + `upgrade execute` |

Transfer app ownership:
```
ecloud compute app ownership transfer --to=<safe-or-timelock-address>
```

---

## Roles (PAUSER / DEVELOPER)

Roles are **app-level permissions**, not identity types. They are granted by the app owner (or admin) to specific EOA addresses.

| Role | What it can do | How it's granted |
|---|---|---|
| ADMIN | All operations | Implicitly the app owner (Safe or Timelock address) |
| PAUSER | Stop the app (direct, no approval needed) | `ecloud compute team grant <address>` |
| DEVELOPER | Read-only + profile set | `ecloud compute team grant <address>` |

Roles are checked at command execution time via on-chain `getTeamRoleMembers()`. They are **not** stored in the identity config.

`ecloud compute app info` can show your role on the app (future enhancement — not implemented yet).

---

## Command Tree

```
ecloud
├── auth
│   ├── generate              — no key (generates + stores)
│   ├── login                 — no key (imports + stores + discovers)
│   ├── logout                — no key (removes key + clears identities)
│   ├── whoami                — no key (reads keyring + config)
│   └── identity
│       ├── new               — KEY: write (deploys Safe/Timelock)
│       ├── list              — no key (reads config)
│       └── select            — no key (writes config)
│
├── compute
│   ├── app
│   │   ├── create            — KEY: write
│   │   ├── deploy            — KEY: write (identity determines: direct / Safe propose)
│   │   ├── upgrade           — KEY: write (blocked for Timelock — use schedule/execute)
│   │   ├── start             — KEY: write (identity determines flow)
│   │   ├── stop              — KEY: write (PAUSER can stop directly)
│   │   ├── terminate         — KEY: write (identity determines flow)
│   │   ├── info              — KEY: read (address only)
│   │   ├── list              — KEY: read (address only)
│   │   ├── releases          — KEY: read (address only)
│   │   ├── logs              — KEY: read (address only)
│   │   ├── profile set       — KEY: write (DEVELOPER can set profile)
│   │   ├── configure tls     — KEY: write
│   │   ├── upgrade
│   │   │   ├── schedule      — KEY: write (Timelock schedule)
│   │   │   ├── execute       — KEY: write (after delay)
│   │   │   └── cancel        — KEY: write
│   │   ├── terminate
│   │   │   ├── schedule      — KEY: write (Timelock schedule)
│   │   │   └── execute       — KEY: write (after delay)
│   │   └── ownership
│   │       ├── transfer      — KEY: write
│   │       ├── schedule-transfer — KEY: write (Timelock schedule)
│   │       └── execute-transfer  — KEY: write (after delay)
│   │
│   ├── build
│   │   ├── submit            — KEY: read (address only)
│   │   ├── status            — KEY: read (address only)
│   │   ├── logs              — KEY: read (address only)
│   │   ├── list              — KEY: read (address only)
│   │   ├── info              — KEY: read (address only)
│   │   └── verify            — KEY: read (address only)
│   │
│   ├── team
│   │   ├── grant             — KEY: write
│   │   ├── revoke            — KEY: write
│   │   ├── list              — KEY: read
│   │   └── grant-admin
│   │       ├── schedule      — KEY: write (Timelock(Safe) only)
│   │       └── execute       — KEY: write (after delay)
│   │
│   ├── environment
│   │   ├── list              — no key
│   │   ├── set               — no key
│   │   └── show              — no key
│   │
│   └── undelegate            — KEY: write
│
├── billing
│   ├── subscribe             — KEY: write
│   ├── cancel                — KEY: write
│   ├── status                — KEY: read
│   └── top-up                — KEY: write
│
├── telemetry
│   ├── enable                — no key
│   ├── disable               — no key
│   └── status                — no key
│
├── upgrade                   — no key
└── version                   — no key
```

**Key types:**
- **KEY: write** — private key signs on-chain transactions. Active identity determines the flow (direct / Safe propose / Timelock schedule).
- **KEY: read** — private key used only to derive address for filtering. Could be replaced by active identity address in the future.
- **no key** — works without credentials.

See `docs/identity-command-matrix.md` for the full command × identity permission matrix.
