# ECloud SDK

A TypeScript SDK and CLI for deploying and managing applications on eigenx TEE (Trusted Execution Environment). This monorepo provides both programmatic SDK access and a command-line interface for interacting with ecloud's decentralized compute platform.

## Overview

ECloud SDK enables developers to:
- Deploy containerized applications to ecloud TEE
- Manage application lifecycle (start, stop, terminate)
- Build and push Docker images with encryption
- Interact with ecloud smart contracts on Ethereum networks
- Monitor application status and logs

## Packages

This monorepo contains two main packages:

### `@layr-labs/ecloud-sdk`

The core TypeScript SDK for programmatic access to ecloud services.

**Features:**
- Type-safe client for ecloud operations
- Docker image building and pushing
- KMS encryption for secure deployments
- Smart contract interactions (EIP7702)
- Environment configuration management

### `@layr-labs/ecloud-cli`

Command-line interface built with oclif for deploying and managing applications.

**Features:**
- Deploy applications from Docker images
- Manage application lifecycle
- Environment-aware configuration
- Support for multiple networks

## Installation

### Prerequisites

- Node.js 18+ 
- pnpm (recommended) or npm
- Docker (for building and pushing images)

### Install Dependencies

```bash
pnpm install
```

### Build

```bash
pnpm build
```

## Usage

### CLI Usage

The CLI is available via the `ecloud` command after building:

```bash
# Deploy an application
npx ecloud app deploy \
  --private-key <your-private-key> \
  --environment sepolia \
  --image <docker-image-reference>
```

**Common Flags:**
- `--private-key`: Your Ethereum private key (or set `ECLOUD_PRIVATE_KEY` env var)
- `--environment`: Target environment (`sepolia` or `mainnet-alpha`)
- `--rpc-url`: Custom RPC URL (optional, or set `ECLOUD_RPC_URL` env var)

**Example:**
```bash
npx ecloud app deploy \
  --private-key 0x... \
  --environment sepolia
```

### SDK Usage

```typescript
import { createECloudClient } from "@layr-labs/ecloud-sdk";

// Create a client
const client = createECloudClient({
  privateKey: "0x...",
  environment: "sepolia", // or "sepolia-dev" or "mainnet-alpha"
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

