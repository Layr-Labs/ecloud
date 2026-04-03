---
name: deploy-eigencloud
description: >
  Deploy, upgrade, and verify apps on EigenCloud/EigenCompute TEE infrastructure using the ecloud CLI. Use this skill when the user asks to "deploy to EigenCloud", "deploy to a TEE", "create an ecloud app", "set up EigenCompute", "run a verifiable build", "check attestation", "upgrade an ecloud deployment", or discusses deploying Docker containers to confidential compute, managing TEE instances (TDX), ecloud billing/subscriptions, USDC credits, cross-compiling for linux/amd64, or troubleshooting ecloud CLI errors. Covers the full lifecycle: auth, build, deploy, verify, upgrade, rollback, terminate.
disable-model-invocation: true
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
---

# EigenCloud Deployment — Agent Runbook

You are deploying to EigenCloud TEE (Trusted Execution Environment) infrastructure. This is a sequential gate-based runbook. Execute each gate in order. On failure, apply the fix and retry before proceeding.

## Constraints you will get wrong without reading this

1. **All images must be `linux/amd64`.** TEEs run on Intel TDX. An arm64 image will deploy successfully but crash at runtime with no useful error. On Apple Silicon: always `docker buildx build --platform linux/amd64`.

2. **Always use hex app IDs (0x...), never display names.** Name lookup is profile-based and silently fails on some commands (confirmed: `app info` by name returns `not found` while the same app works fine by ID).

3. **The CLI returns exit 1 for all errors.** There are no granular exit codes. Parse stdout/stderr content to determine what went wrong.

4. **Env vars are encrypted client-side** before transmission. They are only decrypted inside the TEE. Never visible in logs or API responses.

5. **Derived keys (EVM + Solana wallets) are deterministic per app ID.** They persist across stop/start/upgrade. They are permanently lost if you terminate and redeploy — new app ID means new keys.

6. **`--json` is only available on:** `app releases`, `build submit`, `build status`, `build info`, `build list`, `build verify`. It is NOT available on: `app list`, `app info`, `app deploy`, `billing status`. Do not pass `--json` to commands that don't support it.

7. **No `--dry-run` exists** anywhere in the CLI. No `--yes` on deploy/upgrade (they don't prompt interactively). `--force` only exists on: `app terminate`, `billing cancel`, `auth logout`.

## Current environment

CLI version: !`ecloud --version 2>&1`
Auth: !`ecloud auth whoami 2>&1`
Environment: !`ecloud compute environment show 2>&1`
Host arch: !`uname -m`
Docker: !`docker version --format '{{.Client.Version}}' 2>&1`

---

## Gate 0: Prerequisites

Run all five checks. Fix any that fail before proceeding.

### CLI

```bash
ecloud --version
```
Pass: outputs `@layr-labs/ecloud-cli/<version>`.
Fail: `npm install -g @layr-labs/ecloud-cli`

### Auth

```bash
ecloud auth whoami
```
Pass: output contains `Address: 0x` and `Source: stored credentials`.
Fail:
- New user → `ecloud auth generate --store` (generates key, stores in OS keyring)
- Has existing key → `ecloud auth login` (interactive prompt for private key)
- CI/automation → set `ECLOUD_PRIVATE_KEY` env var instead of keyring

### Environment

```bash
ecloud compute environment show
```
Two environments exist:
- `sepolia` — **Testnet (default).** Uses Sepolia ETH for gas. Deploy here first to test. Billing subscription flow is the same but uses test payment methods. All on-chain records are on Sepolia. Dashboard: `verify-sepolia.eigencloud.xyz`.
- `mainnet-alpha` — **Production.** Uses real ETH for gas, real USDC for payments. Apps are publicly visible on the mainnet verify dashboard: `verify.eigencloud.xyz`. Use when the app is ready for real users and real funds.

**Always develop and test on sepolia first, then redeploy to mainnet-alpha for production.**

Pass: output shows the intended environment.
Fix: `ecloud compute env set sepolia --yes` (or `mainnet-alpha`).

### Billing

```bash
ecloud billing status
```
Pass: output contains `Status: ✓ Active`.
Fail:
1. `ecloud billing subscribe` — creates the subscription
2. `ecloud billing top-up --amount 50` — purchases USDC credits

### Docker

```bash
docker version --format '{{.Client.Version}}'
```
Pass: outputs a version string.
Fail: install Docker Desktop or Docker Engine.

---

## Gate 1: Build and push image

Determine host architecture, then build accordingly.

```bash
uname -m
```

**If `arm64` (Apple Silicon — most common dev machine):**
```bash
docker buildx build --platform linux/amd64 -t <registry>/<image>:<tag> --push .
```
This cross-compiles AND pushes in one step. The `--push` flag is required because buildx cross-compiled images can't be loaded into the local daemon.

**If `x86_64` (native):**
```bash
docker build -t <registry>/<image>:<tag> . && docker push <registry>/<image>:<tag>
```

**After push, verify architecture:**
```bash
docker manifest inspect <registry>/<image>:<tag> 2>&1 | grep architecture
```
Must contain `amd64`. If it shows `arm64`, the image will crash in the TEE.

**Image requirements:**
- Must be in a **public** registry (Docker Hub, GHCR, etc.) — the TEE pulls at deploy time
- Must be OCI-compliant
- App should bind to `0.0.0.0` on its listening port (not `127.0.0.1`)

---

## Gate 2: Deploy

### Instance types

| Instance Type | TEE | Approx $/hr |
|--------------|-----|-------------|
| `g1-micro-1v` | vTPM | ~$0.03 |
| `g1-standard-2s` | — | ~$0.04 |
| `g1-standard-2t` | Intel TDX | ~$0.07 |
| `g1-standard-4s` | — | ~$0.12 |
| `g1-standard-4t` | Intel TDX | ~$0.33 |
| `g1-standard-8t` | Intel TDX | ~$0.66 |

Suffix convention (inferred, not officially documented): `t` = Intel TDX, `s` = likely AMD SEV, `v` = vTPM. Only TDX is confirmed in official EigenCloud docs. Prices are approximate — sourced from billing line items and may change.

For verifiable execution with full attestation, use a `t` (TDX) instance.

### Prepare .env

Create `.env` in the project directory. The CLI reads it by default (override with `--env-file <path>`).

```
PORT=3000
MY_SECRET=value
```

The app's listening port is whatever your application binds to. EigenCloud templates default to 3000 but your app may use any port. Do NOT set `EIGEN_MACHINE_TYPE_PUBLIC` — it is injected automatically from `--instance-type`.

### Path A: Deploy pre-built image

```bash
ecloud compute app deploy \
  --name <app-name> \
  --image-ref <registry>/<image>:<tag> \
  --instance-type g1-standard-4t \
  --env-file .env \
  --log-visibility public \
  --skip-profile \
  --verbose
```

On success, stdout contains the app ID (`0x` followed by 40 hex chars) and a dashboard URL. **Save the app ID** — all subsequent commands need it.

**Important:** The `--name` flag sets the CLI lookup name only, NOT the display name on the verify dashboard. To set the dashboard profile (name, description, website), run `ecloud compute app profile set` after deploy — see Gate 4.

### Path B: Verifiable build (from git source)

The platform clones the repo, builds inside the TEE, and records the build hash onchain for provenance verification.

```bash
ecloud compute build submit \
  --repo https://github.com/org/repo \
  --commit <full-40-char-sha> \
  --dockerfile Dockerfile \
  --context . \
  --json
```

This blocks and streams build logs by default. Use `--no-follow` to exit immediately after submission.

If `--no-follow` was used, poll for completion:
```bash
ecloud compute build status <build-id> --json
```
On build failure: `ecloud compute build logs <build-id> --tail 50`

Then deploy with the verifiable flag:
```bash
ecloud compute app deploy \
  --name <app-name> \
  --verifiable \
  --repo https://github.com/org/repo \
  --commit <sha> \
  --instance-type g1-standard-4t \
  --env-file .env \
  --skip-profile \
  --verbose
```

Additional flags for complex builds:
- Multi-stage with dependencies: `--build-dependencies sha256:...`
- TLS via Caddy: `--build-caddyfile Caddyfile`

### Deploy output parsing

| stdout/stderr contains | Meaning | Next step |
|------------------------|---------|-----------|
| `0x` + 40 hex chars + dashboard URL | Success — deploy initiated | Save app ID → Gate 3 |
| `subscription not active` | No billing subscription | `ecloud billing subscribe` → retry |
| `insufficient credits` | USDC balance too low | `ecloud billing top-up --amount <N>` → retry |
| Image pull error | Image not public, wrong arch, or bad ref | Verify with `docker manifest inspect` → retry |
| `already exists` | App name collision | Change `--name` or use `upgrade` on existing app |

---

## Gate 3: Verify deployment

Deploy returns before the app is fully running. You must poll.

### Poll for running status

```bash
ecloud compute app info <app-id>
```

Parse these fields from output:

- **`Status:`** — one of: `Running`, `Deploying`, `Stopped`, `Terminated`, `Error`
- **`IP:`** — public IP address (direct, no load balancer)
- **`EVM Address:`** — TEE-derived EVM wallet (deterministic per app ID)
- **`Solana Address:`** — TEE-derived Solana wallet (deterministic per app ID)

If `Deploying` → wait 15 seconds, poll again. Typical time to `Running`: 1-3 minutes.
If `Running` → proceed to health check.
If `Error` → check logs: `ecloud compute app logs <app-id>`

### Health check

The app's listening port is exposed directly on the public IP. Check whichever port your app binds to (templates default to 3000).

```bash
curl -s -o /dev/null -w "%{http_code}" http://<IP>:<APP_PORT>/
```

| Response | Meaning |
|----------|---------|
| `200` | App is healthy and serving |
| `404` | App is running but has no route at `/` — check your app's routes |
| `000` | Connection refused — app not ready yet, wrong port, or app crashed on startup |

### Verify provenance (verifiable builds only)

```bash
ecloud compute build verify <image-digest-or-build-id-or-commit> --json
```

Exit 0 + JSON with provenance data = verified.
`No builds found` = image was not built through the verifiable build pipeline.

---

## Gate 4: Post-deploy setup

### Set app profile (dashboard display name)

The verify dashboard shows "(unnamed)" until you set a profile:

```bash
ecloud compute app profile set <app-id> \
  --name "MyApp" \
  --description "What the app does" \
  --website "https://myapp.com" \
  --x-url "https://x.com/myapp"
```

**Constraints:** Profile name cannot contain spaces. Use hyphens or camelCase (e.g., `CitiBike-MPP` not `Citi Bike MPP`).

Dashboard URLs:
- Sepolia: `https://verify-sepolia.eigencloud.xyz/app/<app-id>`
- Mainnet: `https://verify.eigencloud.xyz/app/<app-id>`

### Verifiable builds (recommended for production)

Without `--verifiable`, the dashboard shows `Build: -` and `Provenance: -`, undermining the trust story. To upgrade an existing dev-image deploy to a verifiable build:

```bash
ecloud compute app upgrade <app-id> \
  --verifiable \
  --repo https://github.com/org/repo \
  --commit <full-40-char-sha> \
  --build-dockerfile Dockerfile
```

The repo must be public. After upgrade, verify provenance:
```bash
ecloud compute app releases <app-id> --full
ecloud compute build verify <image-digest-or-commit> --json
```

---

## Upgrade

```bash
ecloud compute app upgrade <app-id> \
  --image-ref <registry>/<image>:<new-tag> \
  --env-file .env \
  --verbose
```

For verifiable upgrade:
```bash
ecloud compute app upgrade <app-id> \
  --verifiable \
  --repo https://github.com/org/repo \
  --commit <new-sha> \
  --verbose
```

After upgrade, re-run Gate 3 (poll `app info` until `Running`, then health check).

App ID and derived keys persist across upgrades.

---

## Rollback

No native rollback command exists. Manual procedure:

**1. Find previous release:**
```bash
ecloud compute app releases <app-id> --json
```
The `releases` array is ordered by creation time. Previous release = second-to-last entry. Extract `registryUrl` and `imageDigest`.

**2. Upgrade to previous image:**
```bash
ecloud compute app upgrade <app-id> \
  --image-ref <registryUrl>@<imageDigest> \
  --verbose
```

**3. Verify:** re-run Gate 3.

**If upgrade fails (app stuck or crashed):**
```bash
ecloud compute app terminate <app-id> --force
ecloud compute app deploy --name <name> --image-ref <old-image> --instance-type <type> --verbose
```
This creates a new app ID. Derived keys will be different. Only do this as a last resort.

---

## Lifecycle commands

```bash
ecloud compute app stop <app-id>              # pause instance, stops billing
ecloud compute app start <app-id>             # resume paused instance
ecloud compute app terminate <app-id> --force # permanent delete, no confirmation
ecloud compute app list                       # show active apps
ecloud compute app list --all                 # include terminated
ecloud compute app logs <app-id> --watch      # stream live logs
ecloud compute app info <app-id> --watch      # auto-refresh every 5s
ecloud compute app info <app-id> --address-count 5  # show more derived addresses
```

---

## Error recovery

| Error | Cause | Fix |
|-------|-------|-----|
| `App name 'X' not found` | Name lookup is profile-based, unreliable | Use hex app ID (0x...) |
| `subscription not active` | No billing subscription | `ecloud billing subscribe` |
| `insufficient credits` | USDC balance depleted | `ecloud billing top-up --amount <N>` |
| Image pull failure | Image not public or wrong architecture | `docker manifest inspect <ref>` — verify `linux/amd64` |
| App crashes immediately after deploy | arm64 image deployed to TDX instance | Rebuild with `docker buildx build --platform linux/amd64` |
| `No builds found` on verify | Image was pushed directly, not via verifiable build | Redeploy with `--verifiable --repo <url> --commit <sha>` |
| Status stuck on `Deploying` | Large image or infrastructure delay | `ecloud compute app logs <app-id>` for diagnostics |
| Auth errors | Key not in keyring or expired | `ecloud auth whoami` to diagnose → `ecloud auth login` to fix |
| Wrong environment | Deployed to sepolia instead of mainnet (or vice versa) | `ecloud compute env show` → `ecloud compute env set <env> --yes` |
| Logs return 425 error | Normal during provisioning (1-2+ min after deploy) | Wait and retry, or use `--watch` to stream when available |
| App shows "(unnamed)" on dashboard | `--name` only sets CLI name, not dashboard profile | `ecloud compute app profile set <app-id> --name "Name"` |
| Profile name rejected | Spaces not allowed in profile names | Use hyphens or camelCase |
| Mainnet app unreachable despite "Running" status | Mainnet networking can take 5+ min after deploy (longer than sepolia) | Keep polling — sepolia ~30s, mainnet can be several minutes |

---

## Internal notes

- **TEE hostname** inside the container is `tee-<app-id>` (lowercase hex, e.g. `tee-0x5940e21020adb5bd2d1fdda4d498edc0eb1f60df`). This appears in structured logs.
- **Networking**: the app binds to `0.0.0.0:<port>` inside the TEE. That port is exposed directly on the public IP — no load balancer or reverse proxy unless you add Caddy for TLS.
- **TLS**: requires running `ecloud compute app configure tls`, setting a DNS A record pointing to the instance IP, then deploying/upgrading. Let's Encrypt rate limit: 5 certs/week per domain. Use ACME staging for first deploy to avoid hitting limits.
- **KMS**: single KMS node in GCP during Mainnet Alpha. Threshold KMS is in development. Keys are derived deterministically after the KMS verifies TEE attestation + onchain whitelisted code.
- **EVM derivation path**: `m/44'/60'/0'/0/0` (and incrementing). **Solana**: `m/44'/501'/0'/0'`.
- **App releases JSON schema** includes: `appId`, `imageDigest` (sha256), `registryUrl`, `publicEnv`, `encryptedEnv`, `upgradeByTime` (unix timestamp), `createdAt`, `createdAtBlock`.

- **TEE attestation is internal-only (as of April 2026).** The TDX attestation JWT exists inside the container at `/run/container_launcher/attestation_verifier_claims_token` but is consumed by KMS at boot and never surfaced to external callers. HTTP response headers contain no attestation proof. The verify dashboard "Attestations" section may show "Loading..." with no data. Public runtime attestations are on the platform roadmap but not yet shipped.
- **Mainnet provisioning is slower than sepolia.** Sepolia apps are typically reachable within 30-60 seconds. Mainnet apps may show `Running` status with memory usage but have no network connectivity for 5+ minutes. This is a known discrepancy.
- **`tee-0x` hostname appears regardless of instance type.** Log hostnames show `tee-<app-id>` even on vTPM (`g1-micro-1v`) instances, not just TDX instances. Do not use the hostname to infer attestation type.

For full CLI flag details, run `ecloud <command> --help`.
