# Base Chain USDC Top-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to purchase credits via USDC on Base (Base Sepolia for now) in addition to Ethereum, with a chain selection prompt when both are available.

**Architecture:** Add optional Base config fields (`baseUsdcCreditsAddress`, `baseRPCURL`) to `EnvironmentConfig`. The billing module creates chain-specific viem clients internally when `chain: "base"` is passed. The CLI prompts for chain selection only when Base is configured for the current environment.

**Tech Stack:** TypeScript, viem (already has `baseSepolia` chain), vitest

---

### Task 1: Add Base chain constants and config fields

**Files:**
- Modify: `packages/sdk/src/client/common/constants.ts`
- Modify: `packages/sdk/src/client/common/types/index.ts`
- Modify: `packages/sdk/src/client/common/config/environment.ts`

- [ ] **Step 1: Add Base Sepolia to SUPPORTED_CHAINS**

In `packages/sdk/src/client/common/constants.ts`, add the `baseSepolia` import and include it in `SUPPORTED_CHAINS`:

```typescript
import { sepolia, mainnet, baseSepolia } from "viem/chains";

export const SUPPORTED_CHAINS = [mainnet, sepolia, baseSepolia] as const;
```

- [ ] **Step 2: Add Base fields to EnvironmentConfig type**

In `packages/sdk/src/client/common/types/index.ts`, add optional Base fields to the `EnvironmentConfig` interface:

```typescript
export interface EnvironmentConfig {
  name: string;
  build: "dev" | "prod";
  chainID: bigint;
  appControllerAddress: Address;
  permissionControllerAddress: string;
  erc7702DelegatorAddress: string;
  kmsServerURL: string;
  userApiServerURL: string;
  defaultRPCURL: string;
  billingRPCURL?: string;
  usdcCreditsAddress?: Address;
  baseUsdcCreditsAddress?: Address;
  baseRPCURL?: string;
}
```

- [ ] **Step 3: Add Base Sepolia chain ID constant and populate config**

In `packages/sdk/src/client/common/config/environment.ts`, add the chain ID constant and populate the `sepolia-dev` and `sepolia` environments:

```typescript
export const BASE_SEPOLIA_CHAIN_ID = 84532;
```

Add to `sepolia-dev` environment object:
```typescript
baseUsdcCreditsAddress: "0x7673a47463F80c6a3553Db9E54c8cDcd5313d0ac",
baseRPCURL: "https://base-sepolia-rpc.publicnode.com",
```

Add to `sepolia` environment object:
```typescript
baseUsdcCreditsAddress: "0x7673a47463F80c6a3553Db9E54c8cDcd5313d0ac",
baseRPCURL: "https://base-sepolia-rpc.publicnode.com",
```

Do NOT add these to `mainnet-alpha` (not deployed yet).

- [ ] **Step 4: Verify the SDK builds**

Run: `cd packages/sdk && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/client/common/constants.ts packages/sdk/src/client/common/types/index.ts packages/sdk/src/client/common/config/environment.ts
git commit -m "feat: add Base Sepolia chain config for USDC credit purchases"
```

---

### Task 2: Add BillingChain type and update TopUpOpts/TopUpInfo

**Files:**
- Modify: `packages/sdk/src/client/modules/billing/index.ts`

- [ ] **Step 1: Add BillingChain type and update interfaces**

At the top of `packages/sdk/src/client/modules/billing/index.ts` (after imports), add the chain type and update the opts/info interfaces:

```typescript
export type BillingChain = "ethereum" | "base";

export interface TopUpOpts {
  amount: bigint;
  account?: Address;
  chain?: BillingChain;
}

export interface TopUpInfo {
  usdcAddress: Address;
  minimumPurchase: bigint;
  usdcBalance: bigint;
  currentAllowance: bigint;
}
```

Also add a new method to the `BillingModule` interface:

```typescript
export interface BillingModule {
  address: Address;
  subscribe: (opts?: SubscriptionOpts) => Promise<SubscribeResponse>;
  getStatus: (opts?: SubscriptionOpts) => Promise<ProductSubscriptionResponse>;
  cancel: (opts?: SubscriptionOpts) => Promise<CancelResponse>;
  getTopUpInfo: (opts?: { chain?: BillingChain }) => Promise<TopUpInfo>;
  topUp: (opts: TopUpOpts) => Promise<TopUpResult>;
  getPaymentMethods: () => Promise<PaymentMethodsResponse>;
  purchaseCredits: (amountCents: number, paymentMethodId?: string) => Promise<CreditPurchaseResponse>;
  hasBaseSupport: () => boolean;
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd packages/sdk && npx tsc --noEmit`
Expected: Errors about implementation not matching interface (expected — we'll fix in next task)

- [ ] **Step 3: Commit**

```bash
git add packages/sdk/src/client/modules/billing/index.ts
git commit -m "feat: add BillingChain type and hasBaseSupport to billing module interface"
```

---

### Task 3: Implement chain-aware getTopUpInfo and topUp

**Files:**
- Modify: `packages/sdk/src/client/modules/billing/index.ts`
- Modify: `packages/cli/src/client.ts`

- [ ] **Step 1: Add privateKey to BillingModuleConfig and update createBillingModule signature**

In `packages/sdk/src/client/modules/billing/index.ts`, update `BillingModuleConfig`:

```typescript
export interface BillingModuleConfig {
  verbose?: boolean;
  walletClient: WalletClient;
  skipTelemetry?: boolean;
  publicClient: PublicClient;
  environment: string;
  privateKey?: Hex;
}
```

Add `Hex` to the existing viem import if not already there. Update the destructuring:

```typescript
const { verbose = false, skipTelemetry = false, walletClient, publicClient, environment, privateKey } = config;
```

- [ ] **Step 2: Pass privateKey from CLI createBillingClient**

In `packages/cli/src/client.ts`, update `createBillingClient` to pass the private key through:

```typescript
return createBillingModule({
  verbose: flags.verbose,
  walletClient,
  publicClient,
  environment,
  skipTelemetry: true,
  privateKey: privateKey as Hex,
});
```

- [ ] **Step 3: Add helper to resolve chain-specific clients and config**

Add these imports at the top of `packages/sdk/src/client/modules/billing/index.ts`:

```typescript
import { createClients } from "../../common/utils/helpers";
import { BASE_SEPOLIA_CHAIN_ID } from "../../common/config/environment";
```

Then inside `createBillingModule`, after the existing `usdcCreditsAddress` resolution block, add:

```typescript
const baseUsdcCreditsAddress = environmentConfig.baseUsdcCreditsAddress;
const baseRPCURL = environmentConfig.baseRPCURL;

function resolveChainConfig(chain?: BillingChain) {
  if (chain === "base") {
    if (!baseUsdcCreditsAddress || !baseRPCURL) {
      throw new Error(`Base chain not configured for environment "${environment}"`);
    }
    if (!privateKey) {
      throw new Error("Private key required for Base chain transactions");
    }
    const baseClients = createClients({
      privateKey,
      rpcUrl: baseRPCURL,
      chainId: BigInt(BASE_SEPOLIA_CHAIN_ID),
    });
    return {
      pub: baseClients.publicClient as PublicClient,
      wallet: baseClients.walletClient as WalletClient,
      creditsAddress: baseUsdcCreditsAddress,
      envConfig: {
        ...environmentConfig,
        chainID: BigInt(BASE_SEPOLIA_CHAIN_ID),
        defaultRPCURL: baseRPCURL,
      },
    };
  }
  return {
    pub: publicClient,
    wallet: walletClient,
    creditsAddress: usdcCreditsAddress,
    envConfig: environmentConfig,
  };
}
```

- [ ] **Step 4: Update getTopUpInfo to accept chain option**

Replace the existing `getTopUpInfo` method with:

```typescript
async getTopUpInfo(opts?: { chain?: BillingChain }): Promise<TopUpInfo> {
  const { pub, creditsAddress } = resolveChainConfig(opts?.chain);

  const usdcAddress = await pub.readContract({
    address: creditsAddress,
    abi: USDCCreditsABI,
    functionName: "usdc",
  }) as Address;

  const [minimumPurchase, usdcBalance, currentAllowance] = await Promise.all([
    pub.readContract({
      address: creditsAddress,
      abi: USDCCreditsABI,
      functionName: "minimumPurchase",
    }) as Promise<bigint>,
    pub.readContract({
      address: usdcAddress,
      abi: ERC20ABI,
      functionName: "balanceOf",
      args: [address],
    }) as Promise<bigint>,
    pub.readContract({
      address: usdcAddress,
      abi: ERC20ABI,
      functionName: "allowance",
      args: [address, creditsAddress],
    }) as Promise<bigint>,
  ]);

  return { usdcAddress, minimumPurchase, usdcBalance, currentAllowance };
},
```

- [ ] **Step 5: Update topUp to use chain-specific clients**

Replace the existing `topUp` method with:

```typescript
async topUp(opts: TopUpOpts): Promise<TopUpResult> {
  return withSDKTelemetry(
    {
      functionName: "topUp",
      skipTelemetry,
      properties: { amount: opts.amount.toString(), chain: opts.chain || "ethereum" },
    },
    async () => {
      const targetAccount = opts.account ?? address;
      const { pub, wallet, creditsAddress, envConfig } = resolveChainConfig(opts.chain);

      const { usdcAddress, currentAllowance } = await module.getTopUpInfo({ chain: opts.chain });

      const executions: Execution[] = [];

      if (currentAllowance < opts.amount) {
        executions.push({
          target: usdcAddress,
          value: 0n,
          callData: encodeFunctionData({
            abi: ERC20ABI,
            functionName: "approve",
            args: [creditsAddress, opts.amount],
          }),
        });
      }

      executions.push({
        target: creditsAddress,
        value: 0n,
        callData: encodeFunctionData({
          abi: USDCCreditsABI,
          functionName: "purchaseCreditsFor",
          args: [opts.amount, targetAccount],
        }),
      });

      const txHash = await executeBatch(
        {
          walletClient: wallet,
          publicClient: pub,
          environmentConfig: envConfig,
          executions,
          pendingMessage: "Submitting credit purchase...",
        },
        logger,
      );

      return { txHash, walletAddress: address };
    },
  );
},
```

- [ ] **Step 6: Implement hasBaseSupport**

Add after the `purchaseCredits` method:

```typescript
hasBaseSupport(): boolean {
  return !!baseUsdcCreditsAddress && !!baseRPCURL;
},
```

- [ ] **Step 7: Verify the SDK builds**

Run: `cd packages/sdk && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add packages/sdk/src/client/modules/billing/index.ts packages/cli/src/client.ts
git commit -m "feat: implement chain-aware getTopUpInfo and topUp for Base support"
```

---

### Task 4: Export BillingChain from SDK package

**Files:**
- Modify: `packages/sdk/src/client/index.ts`

- [ ] **Step 1: Export BillingChain type from SDK entry point**

In `packages/sdk/src/client/index.ts`, find the billing module exports and add `BillingChain`:

```typescript
export { createBillingModule, type BillingModule, type BillingModuleConfig, type TopUpOpts, type TopUpResult, type TopUpInfo, type BillingChain } from "./modules/billing";
```

If the export already exists as a group, just add `type BillingChain` to it.

- [ ] **Step 2: Also export BASE_SEPOLIA_CHAIN_ID**

Add to the environment config exports:

```typescript
export { getEnvironmentConfig, getBillingEnvironmentConfig, getBuildType, getAvailableEnvironments, isEnvironmentAvailable, isMainnet, detectEnvironmentFromChainID, BASE_SEPOLIA_CHAIN_ID } from "./common/config/environment";
```

- [ ] **Step 3: Verify build**

Run: `cd packages/sdk && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/sdk/src/client/index.ts
git commit -m "feat: export BillingChain type and BASE_SEPOLIA_CHAIN_ID from SDK"
```

---

### Task 5: Add chain selection to CLI top-up command

**Files:**
- Modify: `packages/cli/src/commands/billing/top-up.ts`

- [ ] **Step 1: Add chain flag and import BillingChain type**

Add a new optional `--chain` flag to `BillingTopUp.flags`:

```typescript
chain: Flags.string({
  required: false,
  description: "Blockchain network for USDC payment: ethereum or base",
  options: ["ethereum", "base"],
}),
```

Add the `BillingChain` import at the top:

```typescript
import { type BillingChain } from "@layr-labs/ecloud-sdk";
```

- [ ] **Step 2: Add chain selection prompt in handleUsdc**

In the `handleUsdc` method, add chain selection logic BEFORE calling `getTopUpInfo`. Insert after the method signature and before `const onChainState = await billing.getTopUpInfo();`:

```typescript
let selectedChain: BillingChain = "ethereum";

if (billing.hasBaseSupport()) {
  selectedChain =
    (flags.chain as BillingChain) ??
    (await select({
      message: "Which network?",
      choices: [
        { value: "ethereum", name: "Ethereum" },
        { value: "base", name: "Base" },
      ],
    }));
}
```

- [ ] **Step 3: Pass chain to getTopUpInfo and topUp calls**

Update the `getTopUpInfo` call:

```typescript
const onChainState = await billing.getTopUpInfo({ chain: selectedChain });
```

Update the `topUp` call:

```typescript
const { txHash } = await billing.topUp({
  amount: amountRaw,
  account: targetAccount,
  chain: selectedChain,
});
```

- [ ] **Step 4: Update the "No USDC" message to be chain-aware**

Replace the zero-balance message block:

```typescript
if (usdcBalance === BigInt(0)) {
  const networkName = selectedChain === "base" ? "Base Sepolia" : "Sepolia";
  this.log(`\n${chalk.yellow("  No USDC in wallet.")}`);
  this.log(`  Send USDC on ${networkName} to: ${chalk.cyan(walletAddress)}`);
  this.log(`  Then re-run: ${chalk.cyan("ecloud billing top-up")}\n`);
  return;
}
```

- [ ] **Step 5: Verify CLI builds**

Run: `cd packages/cli && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/billing/top-up.ts
git commit -m "feat: add chain selection prompt for USDC top-up (Ethereum/Base)"
```

---

### Task 6: Write tests for chain selection in CLI top-up

**Files:**
- Modify: `packages/cli/src/commands/billing/__tests__/top-up.test.ts`

- [ ] **Step 1: Add hasBaseSupport to mock billing object**

In the `mockBilling` setup in `beforeEach`, add the new method:

```typescript
mockBilling = {
  address: WALLET_ADDRESS,
  getStatus: vi.fn(),
  getTopUpInfo: vi.fn(),
  topUp: vi.fn(),
  getPaymentMethods: vi.fn(),
  purchaseCredits: vi.fn(),
  hasBaseSupport: vi.fn(),
};
```

Update the type annotation for `mockBilling` to include it:

```typescript
let mockBilling: {
  address: string;
  getStatus: ReturnType<typeof vi.fn>;
  getTopUpInfo: ReturnType<typeof vi.fn>;
  topUp: ReturnType<typeof vi.fn>;
  getPaymentMethods: ReturnType<typeof vi.fn>;
  purchaseCredits: ReturnType<typeof vi.fn>;
  hasBaseSupport: ReturnType<typeof vi.fn>;
};
```

By default in `beforeEach`, set `hasBaseSupport` to return false so existing tests are unaffected:

```typescript
mockBilling.hasBaseSupport.mockReturnValue(false);
```

- [ ] **Step 2: Update existing topUp assertions to include chain field**

The existing tests assert `mockBilling.topUp` was called with `{ amount, account }`. Now the CLI always passes `chain: "ethereum"` (the default). Update ALL existing `expect(mockBilling.topUp).toHaveBeenCalledWith(...)` assertions to include `chain: "ethereum"`:

```typescript
// Before:
expect(mockBilling.topUp).toHaveBeenCalledWith({
  amount: BigInt(50_000_000),
  account: WALLET_ADDRESS,
});

// After:
expect(mockBilling.topUp).toHaveBeenCalledWith({
  amount: BigInt(50_000_000),
  account: WALLET_ADDRESS,
  chain: "ethereum",
});
```

Also update any `expect(mockBilling.getTopUpInfo).toHaveBeenCalled()` assertions to expect `{ chain: "ethereum" }` if they check arguments.

- [ ] **Step 3: Add test - prompts for chain when Base is available**

```typescript
it("usdc: prompts for chain selection when Base is available", async () => {
  mockBilling.hasBaseSupport.mockReturnValue(true);
  setupOnChainState();
  mockBilling.topUp.mockResolvedValue({ txHash: TX_HASH, walletAddress: WALLET_ADDRESS });
  mockBilling.getStatus
    .mockResolvedValueOnce({ subscriptionStatus: "active", remainingCredits: 10.0 })
    .mockResolvedValueOnce({ subscriptionStatus: "active", remainingCredits: 60.0 });

  (select as unknown as ReturnType<typeof vi.fn>).mockResolvedValue("base");

  const cmd = createCommand({ amount: "50", method: "usdc" });
  const promise = cmd.run();
  for (let i = 0; i < 10; i++) {
    await vi.advanceTimersByTimeAsync(5_000);
  }
  await promise;

  expect(select).toHaveBeenCalledWith(
    expect.objectContaining({
      message: "Which network?",
      choices: expect.arrayContaining([
        expect.objectContaining({ value: "base" }),
        expect.objectContaining({ value: "ethereum" }),
      ]),
    }),
  );

  expect(mockBilling.getTopUpInfo).toHaveBeenCalledWith({ chain: "base" });
  expect(mockBilling.topUp).toHaveBeenCalledWith({
    amount: BigInt(50_000_000),
    account: WALLET_ADDRESS,
    chain: "base",
  });
});
```

- [ ] **Step 4: Add test - skips chain prompt when Base is NOT available**

```typescript
it("usdc: skips chain prompt when Base is not configured", async () => {
  mockBilling.hasBaseSupport.mockReturnValue(false);
  setupOnChainState();
  mockBilling.topUp.mockResolvedValue({ txHash: TX_HASH, walletAddress: WALLET_ADDRESS });
  mockBilling.getStatus
    .mockResolvedValueOnce({ subscriptionStatus: "active", remainingCredits: 10.0 })
    .mockResolvedValueOnce({ subscriptionStatus: "active", remainingCredits: 60.0 });

  const cmd = createCommand({ amount: "50", method: "usdc" });
  const promise = cmd.run();
  for (let i = 0; i < 10; i++) {
    await vi.advanceTimersByTimeAsync(5_000);
  }
  await promise;

  expect(mockBilling.topUp).toHaveBeenCalledWith({
    amount: BigInt(50_000_000),
    account: WALLET_ADDRESS,
    chain: "ethereum",
  });
});
```

- [ ] **Step 5: Add test - --chain flag skips prompt**

```typescript
it("usdc: --chain flag skips network prompt", async () => {
  mockBilling.hasBaseSupport.mockReturnValue(true);
  setupOnChainState();
  mockBilling.topUp.mockResolvedValue({ txHash: TX_HASH, walletAddress: WALLET_ADDRESS });
  mockBilling.getStatus
    .mockResolvedValueOnce({ subscriptionStatus: "active", remainingCredits: 10.0 })
    .mockResolvedValueOnce({ subscriptionStatus: "active", remainingCredits: 60.0 });

  const cmd = createCommand({ amount: "50", method: "usdc", chain: "base" });
  const promise = cmd.run();
  for (let i = 0; i < 10; i++) {
    await vi.advanceTimersByTimeAsync(5_000);
  }
  await promise;

  expect(mockBilling.topUp).toHaveBeenCalledWith({
    amount: BigInt(50_000_000),
    account: WALLET_ADDRESS,
    chain: "base",
  });
});
```

- [ ] **Step 6: Run tests**

Run: `cd packages/cli && npx vitest run src/commands/billing/__tests__/top-up.test.ts`
Expected: All tests pass (existing + new)

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/billing/__tests__/top-up.test.ts
git commit -m "test: add chain selection tests for Base USDC top-up"
```

---

### Task 7: Verify end-to-end flow compiles and tests pass

**Files:** None (verification only)

- [ ] **Step 1: Full SDK type check**

Run: `cd packages/sdk && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Full CLI type check**

Run: `cd packages/cli && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run all CLI billing tests**

Run: `cd packages/cli && npx vitest run src/commands/billing/__tests__/`
Expected: All tests pass

- [ ] **Step 4: Verify existing non-billing tests still pass**

Run: `cd packages/cli && npx vitest run`
Expected: All tests pass (no regressions)
