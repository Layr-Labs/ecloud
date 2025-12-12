# ECloud SDK and CLI

A TypeScript SDK and CLI for deploying and managing applications on EigenCloud TEE (Trusted Execution Environment). This monorepo provides both programmatic SDK access and a command-line interface for interacting with ecloud's decentralized compute platform.

## Overview

ECloud SDK and CLI enables developers to:

- Deploy containerized applications to ecloud TEE
- Manage application lifecycle (start, stop, terminate)
- Build and push Docker images with encryption
- Monitor application status and logs

## Prerequsites
* Docker - To package and publish application images ([Download](https://www.docker.com/get-started/))
* ETH for gas - For deployment transactions

## Mainnet Alpha Limitations
* Not recommended for customer funds - Mainnet Alpha is intended to enable developers to build, test and ship applications. We do not recommend holding significant customer funds at this stage in Mainnet Alpha.
* Developer is still trusted - Mainnet Alpha does not enable full verifiable and trustless execution. * A later version will ensure developers can not upgrade code maliciously, and liveness guarantees.
No SLA - Mainnet Alpha does not have SLAs around support, and uptime of infrastructure.


## Quick Start
> [!NOTE]
> Migrating from `eigenx`? Head over to [Migration guide](./MIGRATION.md) first
### Installation

```bash
npm install -g @layr-labs/ecloud-cli
```

### Initial Setup 
```bash
# Log in to your Docker registry (required to push images)
docker login

# Log in with an existing private key
ecloud auth login
```

**Don't have a private key?** Use `ecloud auth generate --store` instead

**Need ETH for gas?** Run `ecloud auth whoami` to see your address. For sepolia, get funds from [Google Cloud](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) or [Alchemy](https://sepoliafaucet.com/)

### Get a billing account
This is required to create apps
```bash
ecloud billing subscribe
```

### **Create & Deploy**

```bash
# Create your app (choose: typescript | python | golang | rust)
ecloud compute app create my-app typescript
cd my-app

# Configure environment variables
cp .env.example .env

# Deploy to TEE
ecloud compute app deploy
```

### **Working with Existing Projects**

Have an existing project? You don't need `ecloud compute app create` - the CLI works with any Docker-based project:

```bash
# From your existing project directory
cd my-existing-project

# Ensure you have a Dockerfile and .env file
# The CLI will prompt for these if not found in standard locations

# Deploy directly - the CLI will detect your project
ecloud compute app deploy
```

**What you need:**
- **Dockerfile** - Must target `linux/amd64` and run as root user
- **.env file** - For environment variables (optional but recommended)

The CLI will automatically prompt for the Dockerfile and .env paths if they're not in the default locations. This means you can use ecloud with any existing containerized application without restructuring your project.

**Need TLS/HTTPS?** Run `ecloud compute app configure tls` to add the necessary configuration files for domain setup with private traffic termination in the TEE.

### **View Your App**

```bash
# View app information and logs
ecloud compute app info
ecloud compute app logs

# Add --watch (or -w) to continuously poll for live updates
ecloud compute app info --watch
ecloud compute app logs --watch
```

That's it! Your starter app is now running in a TEE with access to a MNEMONIC that only it can access.

**Ready to customize?** Edit your application code, update `.env` with any API keys you need, then run `ecloud compute app upgrade my-app` to deploy your changes

## Application Environment

Your TEE application runs with these capabilities:

1. **Secure Execution** - Your code runs in an Intel TDX instance with hardware-level isolation
2. **Auto-Generated Wallet** - Access a private mnemonic via `process.env.MNEMONIC`
    - Derive wallet accounts using standard libraries (e.g., viem’s `mnemonicToAccount(process.env.MNEMONIC)`)
    - Only your TEE can decrypt and use this mnemonic
3. **Environment Variables** - All variables from your `.env` file are available in your container
   - Variables with `_PUBLIC` suffix are visible to users for transparency
   - Standard variables remain private and encrypted within the TEE
4. **Onchain Management** - Your app's lifecycle is controlled via Ethereum smart contracts

### Working with Your App

```bash
# List all your apps
ecloud compute app list

# Stop/start your app
ecloud compute app stop my-app
ecloud compute app start my-app

# Terminate your app
ecloud compute app terminate my-app
```

## Authentication

Ecloud CLI needs a private key to sign transactions. Three options:

### 1. OS Keyring (Recommended)

```bash
ecloud auth generate --store # Generate new key and store it
ecloud auth login            # Store an existing key securely
ecloud auth whoami           # Check authentication
ecloud auth logout           # Remove key
```

### 2. Environment Variable

```bash
export ECLOUD_PRIVATE_KEY=0x1234...
ecloud compute app deploy
```

### 3. Command Flag

```bash
ecloud compute app deploy --private-key 0x1234...
```

**Priority:** Flag → Environment → Keyring

## TLS/HTTPS Setup

### Enable TLS

```bash
# Add TLS configuration to your project
ecloud compute app configure tls

# Add variables to .env
cat .env.example.tls >> .env
```

### Configure

Required in `.env`:
```bash
DOMAIN=yourdomain.com
APP_PORT=3000
```

Recommended for first deployment:
```bash
ENABLE_CADDY_LOGS=true  # Debug logs
ACME_STAGING=true       # Test certificates (avoid rate limits)
```

### DNS Setup

Create A record pointing to instance IP:
- Type: A
- Name: yourdomain.com
- Value: `<instance-ip>` (get from `ecloud compute app info`)

### Deploy

```bash
ecloud compute app upgrade
```

### Production Certificates

To switch from staging to production:
```bash
# Set in .env:
ACME_STAGING=false
ACME_FORCE_ISSUE=true  # Only if staging cert exists

# Deploy, then set ACME_FORCE_ISSUE=false for future deploys
```

**Notes:**
- Let's Encrypt rate limit: 5 certificates/week per domain
- Test with staging certificates first to avoid rate limits
- DNS changes may take a few minutes to propagate

## Advanced Usage

### Building and Pushing Images Manually

If you prefer to build and push Docker images yourself instead of letting the CLI handle it, or already have an existing image:

```bash
# Build and push your image manually
docker build --platform linux/amd64 -t myregistry/myapp:v1.0 .
docker push myregistry/myapp:v1.0

# Deploy using the image reference
ecloud compute app deploy myregistry/myapp:v1.0
```

**Requirements:**

- Image must target `linux/amd64` architecture
- Application must run as root user (TEE requirement)

## Telemetry

Ecloud collects anonymous usage data to help us improve the CLI and understand how it's being used. This telemetry is enabled by default but can be easily disabled.

### What We Collect

- Commands used (e.g., `ecloud compute app create`, `ecloud compute app deploy`)
- Error counts and types to identify common issues
- Performance metrics (command execution times)
- System information (OS, architecture)
- Deployment environment (e.g., sepolia, mainnet-alpha)
- User Ethereum address

### What We DON'T Collect

- Personal information or identifiers
- Private keys or sensitive credentials
- Application source code or configurations
- Specific file paths or project names

## Architecture

For a detailed understanding of how Ecloud enables verifiable applications with deterministic identities, see our [Architecture Documentation](docs/ECLOUD_ARCHITECTURE.md).

### Key Components

- **Hardware Isolation** - Intel TDX secure enclaves with memory encryption
- **Attestation** - Cryptographic proof of exact Docker image integrity
- **Deterministic Keys** - Apps receive consistent identities via KMS
- **Smart Contracts** - Onchain configuration and lifecycle management

## Development

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm
- Docker (for building and pushing images)

### Build from source

```bash
git clone https://github.com/Layr-Labs/ecloud
cd ecloud
pnpm install
pnpm build
pnpm ecloud version
```


## SDK Packages

This monorepo contains two main packages:

### `@layr-labs/ecloud-sdk`

The core TypeScript SDK for programmatic access to ecloud services.

**Features:**

- Type-safe client for ecloud operations
- Docker image building and pushing
- KMS encryption for secure deployments
- Smart contract interactions (EIP7702)
- Environment configuration management


## Usage

### SDK Usage

```typescript
import { createECloudClient } from "@layr-labs/ecloud-sdk";

// Create a client
const client = createECloudClient({
  privateKey: "0x...",
  environment: "sepolia", // or "sepolia" or "mainnet-alpha"
  rpcUrl: "https://sepolia.infura.io/v3/...",
});

// Deploy an application
const result = await client.app.deploy({
  image: "myapp:latest",
});

console.log(`Deployed app ID: ${result.appId}`);
console.log(`Transaction hash: ${result.tx}`);

// Start an application
await client.app.start(result.appId);

// Stop an application
await client.app.stop(result.appId);

// Terminate an application
await client.app.terminate(result.appId);
```

## Environments

The SDK supports the following environments:

- **sepolia**: Sepolia testnet
- **mainnet-alpha**: Ethereum mainnet (alpha)

## Development

### Project Structure

```
ecloud-sdk/
├── packages/
│   ├── cli/          # CLI package
│   │   ├── src/
│   │   │   ├── commands/    # CLI commands
│   │   │   └── client.ts    # Client loader
│   │   └── bin/             # CLI entry points
│   └── sdk/          # SDK package
│       └── src/
│           └── client/
│               └── modules/
│                   └── app/  # App management module
│                       ├── deploy/  # Deployment logic
│                       └── index.ts
├── package.json
└── pnpm-workspace.yaml
```

### Scripts

- `pnpm build` - Build all packages
- `pnpm lint` - Lint all packages
- `pnpm format` - Check code formatting
- `pnpm format:fix` - Fix code formatting
- `pnpm test` - Run tests (when implemented)
- `pnpm ecloud` - Run the CLI

### Adding New Commands

1. Create a new command file in `packages/cli/src/commands/`
2. Export a class extending `Command` from `@oclif/core`
3. The command will be automatically discovered by oclif

### Adding New SDK Modules

1. Create a new module in `packages/sdk/src/client/modules/`
2. Export a module factory function (e.g., `createXxxModule`)
3. Add the module to the client in `packages/sdk/src/client/index.ts`

## Deployment Process

The deployment process involves several steps:

1. **Preflight Checks**: Validate environment and configuration
2. **Docker Build**: Build Docker image if needed
3. **Image Push**: Push image to registry
4. **Encryption**: Encrypt sensitive data using KMS
5. **On-Chain Deployment**: Deploy smart contract with app configuration
6. **Status Monitoring**: Watch until application is running

## Security

- Private keys are never stored or logged
- Sensitive data is encrypted using KMS before deployment
- All blockchain interactions use secure wallet clients
- Environment variables are supported for sensitive configuration

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## Support

For issues and questions, please open an issue on GitHub.
