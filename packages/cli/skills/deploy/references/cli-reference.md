# ecloud CLI Reference

Full flag and command reference for `@layr-labs/ecloud-cli`. Reference built from v0.4.0; latest published is v0.4.3.

## Installation

**npm (recommended for dev machines):**
```bash
npm install -g @layr-labs/ecloud-cli
```

**Shell installer (alternative):**
```bash
curl -fsSL https://raw.githubusercontent.com/Layr-Labs/eigencloud-tools/master/install-all.sh | bash
```

## Table of Contents

- [Auth commands](#auth-commands)
- [Billing commands](#billing-commands)
- [Compute app commands](#compute-app-commands)
- [Compute build commands](#compute-build-commands)
- [Environment commands](#environment-commands)
- [Environment variable overrides](#environment-variable-overrides)
- [TLS setup](#tls-setup)
- [App profile](#app-profile)
- [Scaffolding](#scaffolding)
- [Telemetry](#telemetry)
- [Config files](#config-files)

---

## Auth commands

```
ecloud auth generate [--store]       # Generate new private key. --store saves to OS keyring.
ecloud auth gen [--store]            # Alias for generate
ecloud auth new [--store]            # Alias for generate
ecloud auth login                    # Store existing private key in OS keyring (interactive prompt)
ecloud auth logout [--force]         # Remove key from keyring. --force skips confirmation.
ecloud auth migrate                  # Migrate key from eigenx-cli to ecloud
ecloud auth whoami [--private-key]   # Show address and auth source
```

`--private-key <hex>` or `ECLOUD_PRIVATE_KEY` env var overrides keyring on any command.

---

## Billing commands

All billing commands accept: `--environment`, `--private-key`, `--rpc-url`, `--verbose`, `--product compute`.

```
ecloud billing subscribe             # Create subscription (required before deploying)
ecloud billing status                # Show current period, line items, invoice total, payment link
ecloud billing top-up --amount <N>   # Purchase N USDC in credits
  [--account <addr>]                 # Buy credits for a different wallet
ecloud billing cancel [-f|--force]   # Cancel subscription. -f skips prompt.
```

---

## Compute app commands

Common flags on most app commands: `--environment`, `--private-key`, `--rpc-url`, `--verbose`.

### deploy

```
ecloud compute app deploy
  --name <name>                      # App name
  --image-ref <registry/image:tag>   # Docker image reference
  --instance-type <type>             # e.g. g1-standard-4t
  --env-file <path>                  # Default: .env
  --dockerfile <path>                # Path to Dockerfile (for local build)
  --log-visibility public|private|off
  --resource-usage-monitoring enable|disable
  --skip-profile                     # Skip profile setup prompts
  --verifiable                       # Enable verifiable build mode
  --repo <git-url>                   # Git repo URL (with --verifiable)
  --commit <sha>                     # Full 40-char commit SHA (with --verifiable)
  --build-dockerfile <path>          # Dockerfile for verifiable build (default: Dockerfile)
  --build-context <path>             # Build context path (default: .)
  --build-dependencies <sha256:...>  # Dependency image digests (repeatable)
  --build-caddyfile <path>           # Caddyfile path for TLS
  --description <text>               # App description
  --website <url>                    # App website
  --x-url <url>                      # X/Twitter URL
  --image <path>                     # App icon (JPG/PNG, max 4MB)
```

### upgrade

Same flags as deploy except `--name` and `--skip-profile`. Takes `[APP-ID]` as argument.

### info

```
ecloud compute app info [APP-ID]
  --watch | -w                       # Refresh every 5s
  --address-count <N>                # Number of derived addresses to show (default: 1)
```

### list

```
ecloud compute app list
  --all | -a                         # Include terminated apps
  --address-count <N>                # Addresses to fetch per app
```

### logs

```
ecloud compute app logs [APP-ID]
  --watch | -w                       # Stream continuously
```

### releases

```
ecloud compute app releases [APP-ID]
  --json                             # JSON output
  --full                             # Multi-line detail view
```

JSON schema:
```json
{
  "appID": "0x...",
  "releases": [{
    "appId": "0x...",
    "rmsReleaseId": "0",
    "imageDigest": "sha256:...",
    "registryUrl": "docker.io/org/image",
    "publicEnv": "{...}",
    "encryptedEnv": "...",
    "upgradeByTime": 1773270293,
    "createdAt": "1773266712",
    "createdAtBlock": "10429146"
  }]
}
```

### start / stop / terminate

```
ecloud compute app start [APP-ID]
ecloud compute app stop [APP-ID]
ecloud compute app terminate [APP-ID] [--force]
```

### configure tls

```
ecloud compute app configure tls
```

Interactive: prompts for domain, app port, ACME staging preference, and Caddy log settings. Creates a `Caddyfile` and appends TLS env vars (`DOMAIN`, `APP_PORT`, `ACME_STAGING`, `ENABLE_CADDY_LOGS`, `ACME_FORCE_ISSUE`) to `.env`. TLS certs are auto-obtained via Let's Encrypt using the TEE's `tls-keygen` tool.

Requires a DNS A record pointing to the instance IP before deploy/upgrade. Let's Encrypt rate limit: 5 certs/week per domain — use `ACME_STAGING=true` for initial testing.

### profile set

```
ecloud compute app profile set [APP-ID]
  --name <name>
  --description <text>
  --website <url>
  --x-url <url>
  --image <path>                     # JPG/PNG, max 4MB, square recommended
```

---

## Compute build commands

Common flags: `--environment`, `--private-key`, `--rpc-url`, `--verbose`.

### submit

```
ecloud compute build submit
  --repo <git-url>                   # Required
  --commit <40-char-sha>             # Required
  --dockerfile <path>                # Default: Dockerfile
  --context <path>                   # Default: .
  --dependencies <sha256:...>        # Repeatable
  --build-caddyfile <path>           # Optional Caddyfile
  --no-follow                        # Exit after submission, don't stream logs
  --json                             # JSON output
```

### status / info

```
ecloud compute build status [BUILD-ID] [--json]
ecloud compute build info [BUILD-ID] [--json]
```

### list

```
ecloud compute build list
  --limit <N>                        # Default: 20, max: 100
  --offset <N>                       # Pagination offset
  --json
```

### logs

```
ecloud compute build logs [BUILD-ID]
  --follow | -f                      # Stream in real-time
  --tail <N>                         # Last N lines
```

### verify

```
ecloud compute build verify [IDENTIFIER] [--json]
```

Identifier can be: build ID, image digest (sha256:...), or git commit SHA.

---

## Environment commands

```
ecloud compute environment list      # Available: sepolia, mainnet-alpha
ecloud compute environment show      # Current active environment
ecloud compute environment set [ENV] [--yes]  # --yes skips confirmation
ecloud compute env list|show|set     # Aliases
```

---

## Environment variable overrides

| Env Var | Overrides |
|---------|-----------|
| `ECLOUD_PRIVATE_KEY` | `--private-key` |
| `ECLOUD_ENV` | `--environment` |
| `ECLOUD_RPC_URL` | `--rpc-url` |
| `ECLOUD_NAME` | `--name` |
| `ECLOUD_IMAGE_REF` | `--image-ref` |
| `ECLOUD_DOCKERFILE_PATH` | `--dockerfile` |
| `ECLOUD_ENVFILE_PATH` | `--env-file` |
| `ECLOUD_INSTANCE_TYPE` | `--instance-type` |
| `ECLOUD_LOG_VISIBILITY` | `--log-visibility` |
| `ECLOUD_BUILD_REPO` | `--repo` |
| `ECLOUD_BUILD_COMMIT` | `--commit` |
| `ECLOUD_BUILD_DOCKERFILE` | `--build-dockerfile` |
| `ECLOUD_BUILD_CONTEXT` | `--build-context` |
| `ECLOUD_BUILD_CADDYFILE` | `--build-caddyfile` |
| `ECLOUD_RESOURCE_USAGE_MONITORING` | `--resource-usage-monitoring` |
| `ECLOUD_PRODUCT_ID` | `--product` |

---

## Scaffolding

```
ecloud compute app create
  --name <name>
  --language typescript|golang|rust|python
  --template-repo <url>              # Custom template
  --template-version <ref>           # Template version/branch
```

Interactive if flags omitted.

---

## Telemetry

```
ecloud telemetry status              # Enabled by default
ecloud telemetry disable
ecloud telemetry enable
```

---

## EIP-7702 delegation

```
ecloud compute undelegate            # Remove EIP-7702 account delegation
```

---

## Config files

- `~/.config/ecloud/config.yaml` — production config (user_uuid, profile cache)
- `~/.config/ecloud-dev/config.yaml` — dev config
- Not typically edited manually
