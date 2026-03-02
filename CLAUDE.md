# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ECloud is a TypeScript monorepo providing SDK and CLI tools for deploying and managing applications on EigenCloud TEE (Trusted Execution Environment). The system enables developers to deploy containerized applications with deterministic wallet identities and hardware-level isolation using Intel TDX.

**Key capabilities:**
- Deploy Docker containers to TEE with auto-generated wallets
- Hardware-isolated execution with cryptographic attestation
- Smart contract-based lifecycle management
- KMS encryption for secure environment variable handling

## Repository Structure

This is a pnpm monorepo with two main packages:

- **`packages/sdk/`** - Core TypeScript SDK (`@layr-labs/ecloud-sdk`)
  - Programmatic access to ecloud services
  - Exports: main client, compute module, billing module, browser-specific bundle
  - Entry points: `src/index.ts`, `src/compute.ts`, `src/billing.ts`, `src/browser.ts`

- **`packages/cli/`** - Command-line interface (`@layr-labs/ecloud-cli`)
  - Built with oclif framework
  - Commands auto-discovered from `packages/cli/src/commands/`
  - Binary entry: `bin/run.js`

## Build System

Both packages use `tsup` for building:

- **Build Types**: Environment variable `BUILD_TYPE` controls which environments are available
  - `dev`: Only `sepolia-dev` environment
  - `prod`: `sepolia` and `mainnet-alpha` environments (default)

- **Build-time Constants**: Injected via tsup's `define` option
  - `BUILD_TYPE_BUILD_TIME`: Determines available environments
  - `SDK_VERSION_BUILD_TIME` / `CLI_VERSION_BUILD_TIME`: Version from `PACKAGE_VERSION` env or package.json
  - `POSTHOG_API_KEY_BUILD_TIME`: Optional telemetry key

- **Template Loading**: `.tmpl` and `.pem` files loaded as text via tsup loader

## Common Development Commands

```bash
# Install dependencies
pnpm install

# Build all packages (production)
pnpm build

# Build for development (enables sepolia-dev environment)
pnpm build:dev
# or
BUILD_TYPE=dev pnpm build

# Run the CLI locally
pnpm ecloud [command]

# Linting and formatting
pnpm lint
pnpm format        # Check formatting
pnpm format:fix    # Fix formatting issues

# Type checking
pnpm typecheck

# Individual package commands
pnpm -C packages/sdk build
pnpm -C packages/cli build
```

## Environment Configuration

Environments are defined in `packages/sdk/src/client/common/config/environment.ts`:

- **Sepolia (testnet)**: `sepolia` (prod) or `sepolia-dev` (dev build)
- **Mainnet**: `mainnet-alpha` (prod only)

Each environment specifies:
- Smart contract addresses (AppController, PermissionController, ERC7702Delegator)
- KMS server URL
- User API server URL
- Default RPC URL
- Chain ID (Sepolia: 11155111, Mainnet: 1)

**Important**: Environment availability is controlled by build type. Production builds cannot access `sepolia-dev`, and dev builds can only access `sepolia-dev`.

## Architecture Patterns

### Client Creation
The SDK uses a modular client architecture:
1. `createECloudClient()` (main entry) creates wallet and public clients using viem
2. Returns modules: `compute` and `billing`
3. Each module is created by factory functions (`createComputeModule`, `createBillingModule`)

### SDK vs CLI Separation
- **SDK** (`packages/sdk`): Non-interactive, requires all parameters explicitly
  - Uses viem's WalletClient and PublicClient for blockchain interactions
  - Exports both high-level clients and low-level functions for custom workflows

- **CLI** (`packages/cli`): Interactive, prompts for missing parameters
  - Uses oclif for command structure
  - Imports SDK functions and wraps them with interactive prompts
  - Authentication handled via OS keyring, environment variables, or flags

### Deployment Flow
The deployment process is split into phases (see `packages/sdk/src/client/modules/compute/app/deploy.ts`):

1. **Prepare phase** (`prepareDeploy`):
   - Validate inputs (app name, image reference, environment variables)
   - Build Docker image if needed (via `prepareRelease`)
   - Push to registry
   - Encrypt environment variables with KMS public key (RSA-OAEP-256 + AES-256-GCM)
   - Create deployment batch data
   - Estimate gas costs

2. **Execute phase** (`executeDeploy`):
   - Create EIP-7702 authorization list (delegation to ERC7702Delegator contract)
   - Execute batch transaction with deployment data
   - Return app ID and transaction hash

3. **Watch phase** (`watchDeployment`):
   - Monitor transaction confirmation
   - Poll User API until app reaches "running" state

This split enables the CLI to show gas estimates and get user confirmation before executing.

### EIP-7702 Batch Execution
The system uses EIP-7702 for atomic multi-call transactions:
- Developer's EOA delegates code execution to `ERC7702Delegator` contract
- Batch contains multiple contract calls (e.g., deploy + start)
- All operations execute atomically in a single transaction
- See `packages/sdk/src/client/common/contract/eip7702.ts` for implementation

### KMS Encryption
Environment variables are encrypted before on-chain storage:
- Uses JWE (JSON Web Encryption) with `jose` library
- Key encryption: RSA-OAEP-256 (public key from KMS)
- Content encryption: AES-256-GCM
- Protected headers include `x-eigenx-app-id` for app identification
- Implementation: `packages/sdk/src/client/common/encryption/kms.ts`

### Template System
The CLI can create starter apps from templates:
- Templates stored in `packages/sdk/src/client/common/templates/`
- Template catalog fetched from remote source
- Categories: TypeScript, Python, Golang, Rust, etc.
- Handlebars used for variable substitution
- Created apps include Dockerfile, .env, and starter code

## Testing

Currently no project-specific test files exist. Tests would typically be added as:
- `*.test.ts` files co-located with source files
- Run with `pnpm test` (uses vitest as configured in root package.json)

## Smart Contract Interactions

All blockchain interactions use `viem`:
- Wallet client for signing transactions
- Public client for reading state
- Contract calls encoded with `encodeFunctionData`
- ABIs located in `packages/sdk/src/client/common/abis/`

## Authentication

Three methods (priority order: flag → environment → keyring):
1. Command flag: `--private-key 0x...`
2. Environment variable: `ECLOUD_PRIVATE_KEY`
3. OS keyring: via `@napi-rs/keyring` package

## Telemetry

Optional anonymous usage tracking via PostHog:
- API key injected at build time
- Can be disabled via CLI commands: `ecloud telemetry disable`
- Implementation: `packages/sdk/src/client/common/telemetry/`

## Important Code Locations

- **Environment config**: `packages/sdk/src/client/common/config/environment.ts`
- **Contract callers**: `packages/sdk/src/client/common/contract/caller.ts`
- **EIP-7702 handling**: `packages/sdk/src/client/common/contract/eip7702.ts`
- **Docker operations**: `packages/sdk/src/client/common/docker/`
- **KMS encryption**: `packages/sdk/src/client/common/encryption/kms.ts`
- **Deployment logic**: `packages/sdk/src/client/modules/compute/app/deploy.ts`
- **CLI commands**: `packages/cli/src/commands/` (oclif auto-discovery)

## Development Workflow

When adding features:
1. Implement core logic in SDK (`packages/sdk/src/`) as non-interactive functions
2. Export from appropriate module or main index
3. Add CLI command (`packages/cli/src/commands/`) that wraps SDK with interactive prompts
4. Build both packages: `pnpm build`
5. Test locally: `pnpm ecloud [your-command]`

## Git Conventions

- Main branch: `master`
- Feature branches: descriptive names (e.g., `sm-eigenxKmsClient`)
- Commit with co-authorship when using AI assistance
