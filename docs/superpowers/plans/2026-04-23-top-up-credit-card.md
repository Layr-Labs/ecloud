# Top-Up Credit Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add credit card payment support to `ecloud billing top-up` alongside the existing USDC on-chain flow.

**Architecture:** Two new SDK methods (`getPaymentMethods`, `purchaseCredits`) on the existing `BillingApiClient` call the `/v1/payment-methods` and `/v1/credits/purchase` endpoints using the same EIP-712 auth. The CLI `top-up` command gets a `--method` flag and branches into the existing USDC path or a new credit card path with card-on-file detection.

**Tech Stack:** TypeScript, oclif (CLI framework), viem (wallet), vitest (tests), `open` package (browser), `@inquirer/prompts` (interactive prompts)

**Spec:** `docs/superpowers/specs/2026-04-23-top-up-credit-card-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/sdk/src/client/common/types/index.ts` | Modify | Add `PaymentMethod`, `PaymentMethodsResponse`, `CreditPurchaseResponse` types |
| `packages/sdk/src/client/common/utils/billingapi.ts` | Modify | Add `getPaymentMethods()` and `purchaseCredits()` methods to `BillingApiClient` |
| `packages/sdk/src/client/modules/billing/index.ts` | Modify | Expose new methods on `BillingModule` interface and wire them in `createBillingModule` |
| `packages/cli/src/commands/billing/top-up.ts` | Modify | Add `--method` flag, payment method selection prompt, credit card purchase flow |
| `packages/cli/src/commands/billing/__tests__/top-up.test.ts` | Modify | Add credit card flow test cases |

---

## Task 1: Add new types to SDK

**Files:**
- Modify: `packages/sdk/src/client/common/types/index.ts:420-425` (after `SubscriptionOpts`, before `BillingEnvironmentConfig`)

- [ ] **Step 1: Add the new type definitions**

Insert after the `SubscriptionOpts` interface (line 420) and before the `BillingEnvironmentConfig` interface (line 422):

```typescript
export interface PaymentMethod {
  id: string;
  stripePaymentMethodId: string;
  createdAt: string;
}

export interface PaymentMethodsResponse {
  paymentMethods: PaymentMethod[];
}

export interface CreditPurchaseResponse {
  purchaseId?: string;
  checkoutSessionId?: string;
  checkoutUrl?: string;
  amountCents: string;
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit -p packages/sdk/tsconfig.json`
Expected: Clean exit, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/sdk/src/client/common/types/index.ts
git commit -m "feat(sdk): add PaymentMethod and CreditPurchaseResponse types"
```

---

## Task 2: Add `getPaymentMethods()` and `purchaseCredits()` to `BillingApiClient`

**Files:**
- Modify: `packages/sdk/src/client/common/utils/billingapi.ts:176-179` (after `cancelSubscription`, before the Internal Methods section)

- [ ] **Step 1: Add the import for new types**

In `billingapi.ts`, add `PaymentMethodsResponse` and `CreditPurchaseResponse` to the existing import from `"../types"`:

```typescript
import {
  ProductID,
  CreateSubscriptionOptions,
  CreateSubscriptionResponse,
  GetSubscriptionOptions,
  ProductSubscriptionResponse,
  PaymentMethodsResponse,
  CreditPurchaseResponse,
} from "../types";
```

- [ ] **Step 2: Add `getPaymentMethods()` method**

Insert after `cancelSubscription` (line 178) and before the `// Internal Methods` comment (line 181):

```typescript
  async getPaymentMethods(): Promise<PaymentMethodsResponse> {
    const endpoint = `${this.config.billingApiServerURL}/v1/payment-methods`;
    const resp = await this.makeAuthenticatedRequest(endpoint, "GET", "compute");
    return resp.json();
  }

  async purchaseCredits(
    amountCents: number,
    paymentMethodId?: string,
  ): Promise<CreditPurchaseResponse> {
    const endpoint = `${this.config.billingApiServerURL}/v1/credits/purchase`;
    const body: Record<string, unknown> = { amountCents };
    if (paymentMethodId) {
      body.paymentMethodId = paymentMethodId;
    }
    const resp = await this.makeAuthenticatedRequest(endpoint, "POST", "compute", body);
    return resp.json();
  }
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit -p packages/sdk/tsconfig.json`
Expected: Clean exit, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/sdk/src/client/common/utils/billingapi.ts
git commit -m "feat(sdk): add getPaymentMethods and purchaseCredits to BillingApiClient"
```

---

## Task 3: Expose new methods on `BillingModule`

**Files:**
- Modify: `packages/sdk/src/client/modules/billing/index.ts:47-56` (BillingModule interface) and `~90` (module object in `createBillingModule`)

- [ ] **Step 1: Add imports for new types**

Add `PaymentMethodsResponse` and `CreditPurchaseResponse` to the import from `"../../common/types"`:

```typescript
import type {
  ProductID,
  SubscriptionOpts,
  SubscribeResponse,
  CancelResponse,
  ProductSubscriptionResponse,
  PaymentMethodsResponse,
  CreditPurchaseResponse,
} from "../../common/types";
```

- [ ] **Step 2: Extend the `BillingModule` interface**

Add these two methods to the `BillingModule` interface (after the `topUp` method, before the closing brace):

```typescript
  getPaymentMethods: () => Promise<PaymentMethodsResponse>;
  purchaseCredits: (amountCents: number, paymentMethodId?: string) => Promise<CreditPurchaseResponse>;
```

- [ ] **Step 3: Wire the methods in `createBillingModule`**

Inside the `const module: BillingModule = { ... }` object, after the `cancel` method definition (around line 283), add:

```typescript
    async getPaymentMethods() {
      return billingApi.getPaymentMethods();
    },

    async purchaseCredits(amountCents: number, paymentMethodId?: string) {
      return billingApi.purchaseCredits(amountCents, paymentMethodId);
    },
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit -p packages/sdk/tsconfig.json`
Expected: Clean exit, no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/client/modules/billing/index.ts
git commit -m "feat(sdk): expose getPaymentMethods and purchaseCredits on BillingModule"
```

---

## Task 4: Add credit card flow to `top-up.ts` CLI command

**Files:**
- Modify: `packages/cli/src/commands/billing/top-up.ts`

- [ ] **Step 1: Update imports**

Replace the existing imports at the top of the file:

```typescript
import { Command, Flags } from "@oclif/core";
import { createBillingClient } from "../../client";
import { commonFlags } from "../../flags";
import { type Address, formatUnits } from "viem";
import chalk from "chalk";
import { input, select, confirm } from "@inquirer/prompts";
import open from "open";
import { withTelemetry } from "../../telemetry";
```

Note: `select` and `confirm` are added from `@inquirer/prompts`; `open` is added for opening checkout URLs in browser.

- [ ] **Step 2: Update command description and add `--method` flag**

Update the static properties on the class:

```typescript
export default class BillingTopUp extends Command {
  static description = "Purchase EigenCompute credits with USDC or credit card";

  static examples = [
    "<%= config.bin %> billing top-up",
    "<%= config.bin %> billing top-up --method usdc --amount 50",
    "<%= config.bin %> billing top-up --method card --amount 25",
  ];

  static flags = {
    ...commonFlags,
    method: Flags.string({
      required: false,
      description: "Payment method: usdc (on-chain) or card (credit card)",
      options: ["usdc", "card"],
    }),
    amount: Flags.string({
      required: false,
      description: "Amount to spend (USDC for on-chain, whole dollars for card)",
    }),
    account: Flags.string({
      required: false,
      description: "Target account address for purchaseCreditsFor (defaults to your wallet)",
    }),
    product: Flags.string({
      required: false,
      description: "Product ID",
      default: "compute",
      options: ["compute"],
      env: "ECLOUD_PRODUCT_ID",
    }),
  };
```

- [ ] **Step 3: Update the `run()` method — payment method selection and branching**

Replace the entire `run()` method body. The structure is:

1. Create billing client, show wallet info and current credits (unchanged).
2. Select payment method (prompt or flag).
3. Branch to USDC path or credit card path.

```typescript
  async run() {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(BillingTopUp);

      const billing = await createBillingClient(flags);
      const walletAddress = billing.address;
      const targetAccount = (flags.account as Address) ?? walletAddress;

      this.log(`\n${chalk.bold("Purchase EigenCompute credits")}`);
      this.log(`${chalk.gray("─".repeat(45))}`);
      this.log(`\n  ${chalk.bold("Wallet:")}  ${walletAddress}`);
      if (targetAccount !== walletAddress) {
        this.log(`  ${chalk.bold("Target:")}  ${targetAccount}`);
      }

      // Show current credit balance
      let baselineTotal: number | undefined;
      try {
        const status = await billing.getStatus({
          productId: flags.product as "compute",
        });
        const remaining = status.remainingCredits ?? 0;
        const applied = status.creditsApplied ?? 0;
        baselineTotal = remaining + applied;
        this.log(`  ${chalk.bold("Credits:")} ${chalk.cyan(`$${remaining.toFixed(2)}`)}`);
      } catch {
        this.debug("Could not fetch current credit balance");
      }

      // Select payment method
      const method =
        flags.method ??
        (await select({
          message: "How would you like to pay?",
          choices: [
            { value: "card", name: "Credit card" },
            { value: "usdc", name: "USDC (on-chain)" },
          ],
        }));

      if (method === "usdc") {
        await this.handleUsdc(billing, flags, walletAddress, targetAccount, baselineTotal);
      } else {
        await this.handleCard(billing, flags, baselineTotal);
      }
    });
  }
```

- [ ] **Step 4: Extract USDC path into `handleUsdc` method**

Add this private method. This is the existing USDC flow extracted with no logic changes:

```typescript
  private async handleUsdc(
    billing: Awaited<ReturnType<typeof createBillingClient>>,
    flags: Record<string, any>,
    walletAddress: Address,
    targetAccount: Address,
    baselineTotal: number | undefined,
  ) {
    const onChainState = await billing.getTopUpInfo();
    const { usdcBalance, minimumPurchase } = onChainState;

    const balanceFormatted = formatUnits(usdcBalance, 6);
    this.log(`  ${chalk.bold("USDC:")}    ${balanceFormatted} USDC`);

    if (usdcBalance === BigInt(0)) {
      this.log(`\n${chalk.yellow("  No USDC in wallet.")}`);
      this.log(`  Send USDC on Sepolia to: ${chalk.cyan(walletAddress)}`);
      this.log(`  Then re-run: ${chalk.cyan("ecloud billing top-up")}\n`);
      return;
    }

    const minimumFormatted = formatUnits(minimumPurchase, 6);
    const amountStr =
      flags.amount ??
      (await input({
        message: `How much USDC to spend on credits? (minimum: ${minimumFormatted})`,
        validate: (val) => {
          const n = parseFloat(val);
          if (isNaN(n) || n <= 0) return "Enter a positive number";
          const raw = BigInt(Math.round(n * 1e6));
          if (raw < minimumPurchase)
            return `Minimum purchase is ${minimumFormatted} USDC`;
          if (raw > usdcBalance)
            return `Insufficient balance. You have ${balanceFormatted} USDC`;
          return true;
        },
      }));

    const amountFloat = parseFloat(amountStr);
    const amountRaw = BigInt(Math.round(amountFloat * 1e6));

    if (amountRaw < minimumPurchase) {
      this.error(`Minimum purchase is ${minimumFormatted} USDC`);
    }
    if (amountRaw > usdcBalance) {
      this.error(
        `Insufficient USDC balance. You have ${balanceFormatted} USDC but requested ${amountFloat.toFixed(2)}`,
      );
    }

    this.log(`\n  Purchasing ${chalk.bold(`$${amountFloat.toFixed(2)}`)} in credits...`);

    const { txHash } = await billing.topUp({
      amount: amountRaw,
      account: targetAccount,
    });
    this.log(`  ${chalk.green("✓")} Transaction confirmed: ${txHash}`);

    await this.pollForCredits(billing, flags, baselineTotal, amountFloat);
  }
```

- [ ] **Step 5: Add `handleCard` method**

```typescript
  private async handleCard(
    billing: Awaited<ReturnType<typeof createBillingClient>>,
    flags: Record<string, any>,
    baselineTotal: number | undefined,
  ) {
    const MINIMUM_DOLLARS = 5;

    // Prompt for amount
    const amountStr =
      flags.amount ??
      (await input({
        message: `How many dollars of credits to purchase? (minimum: $${MINIMUM_DOLLARS})`,
        validate: (val) => {
          const n = parseInt(val, 10);
          if (isNaN(n) || n <= 0) return "Enter a positive whole number";
          if (n.toString() !== val.trim()) return "Enter a whole dollar amount (no cents)";
          if (n < MINIMUM_DOLLARS) return `Minimum purchase is $${MINIMUM_DOLLARS}`;
          return true;
        },
      }));

    const dollars = parseInt(amountStr, 10);
    if (isNaN(dollars) || dollars < MINIMUM_DOLLARS) {
      this.error(`Minimum purchase is $${MINIMUM_DOLLARS}`);
    }
    const amountCents = dollars * 100;

    // Check for existing payment methods
    const { paymentMethods } = await billing.getPaymentMethods();

    let useExistingCard = false;
    let paymentMethodId: string | undefined;

    if (paymentMethods.length > 0) {
      const card = paymentMethods[0];
      const lastFour = card.stripePaymentMethodId.slice(-4);
      useExistingCard = await confirm({
        message: `Use card on file (ending in ${lastFour})?`,
        default: true,
      });
      if (useExistingCard) {
        paymentMethodId = card.id;
      }
    }

    this.log(`\n  Purchasing ${chalk.bold(`$${dollars}`)} in credits...`);

    const result = await billing.purchaseCredits(amountCents, paymentMethodId);

    if (result.checkoutUrl) {
      this.log(`\n  ${chalk.cyan(result.checkoutUrl)}`);
      this.log(chalk.gray("  Opening checkout in browser..."));
      await open(result.checkoutUrl);
    } else {
      this.log(`  ${chalk.green("✓")} Payment submitted`);
    }

    await this.pollForCredits(billing, flags, baselineTotal, dollars);
  }
```

- [ ] **Step 6: Extract shared polling into `pollForCredits` method**

```typescript
  private async pollForCredits(
    billing: Awaited<ReturnType<typeof createBillingClient>>,
    flags: Record<string, any>,
    baselineTotal: number | undefined,
    amountPurchased: number,
  ) {
    this.log(chalk.gray("\n  Waiting for credits to appear..."));
    const startTime = Date.now();
    while (Date.now() - startTime < POLL_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      try {
        const status = await billing.getStatus({
          productId: flags.product as "compute",
        });
        const remaining = status.remainingCredits ?? 0;
        const applied = status.creditsApplied ?? 0;
        const currentTotal = remaining + applied;
        this.debug(
          `Poll: remaining=${remaining}, applied=${applied}, total=${currentTotal}, baseline=${baselineTotal}`,
        );
        if (baselineTotal === undefined || currentTotal > baselineTotal) {
          const creditsAdded =
            baselineTotal !== undefined ? currentTotal - baselineTotal : undefined;
          this.log(
            `\n  ${chalk.green("✓")} Credits received: ${chalk.cyan(`$${(creditsAdded ?? amountPurchased).toFixed(2)}`)}`,
          );
          if (remaining > 0) {
            this.log(`  Remaining balance: ${chalk.cyan(`$${remaining.toFixed(2)}`)}`);
          }
          this.log();
          return;
        }
      } catch {
        this.debug("Error polling for credit balance");
      }
    }

    this.log(
      `\n  ${chalk.yellow("⚠")} Credits haven't appeared yet. This can take a few minutes.`,
    );
    this.log(`  ${chalk.gray("Check your balance:")} ecloud billing status\n`);
  }
```

- [ ] **Step 7: Verify types compile**

Run: `npx tsc --noEmit -p packages/cli/tsconfig.json`
Expected: Clean exit, no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/commands/billing/top-up.ts
git commit -m "feat(cli): add credit card payment flow to billing top-up"
```

---

## Task 5: Update tests for credit card flow

**Files:**
- Modify: `packages/cli/src/commands/billing/__tests__/top-up.test.ts`

- [ ] **Step 1: Update mocks to include new imports**

Replace the mock setup at the top of the file. The `@inquirer/prompts` mock needs `select` and `confirm` added; `open` needs to be mocked:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../client", () => ({
  createBillingClient: vi.fn(),
}));

vi.mock("../../../telemetry", () => ({
  withTelemetry: vi.fn((_cmd: unknown, fn: () => Promise<void>) => fn()),
}));

vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("open", () => ({
  default: vi.fn(),
}));

import BillingTopUp from "../top-up";
import { createBillingClient } from "../../../client";
import { input, select, confirm } from "@inquirer/prompts";
```

- [ ] **Step 2: Update `mockBilling` in `beforeEach` to include new methods**

```typescript
  let mockBilling: {
    address: string;
    getStatus: ReturnType<typeof vi.fn>;
    getTopUpInfo: ReturnType<typeof vi.fn>;
    topUp: ReturnType<typeof vi.fn>;
    getPaymentMethods: ReturnType<typeof vi.fn>;
    purchaseCredits: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    logOutput = [];
    mockBilling = {
      address: WALLET_ADDRESS,
      getStatus: vi.fn(),
      getTopUpInfo: vi.fn(),
      topUp: vi.fn(),
      getPaymentMethods: vi.fn(),
      purchaseCredits: vi.fn(),
    };
    (createBillingClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockBilling);

    (input as ReturnType<typeof vi.fn>).mockResolvedValue("50");
  });
```

- [ ] **Step 3: Update existing USDC tests**

The existing tests need to set `flags.method: "usdc"` since the flow now branches on method. Update the `createCommand` helper:

```typescript
  function createCommand(flags: Record<string, unknown> = {}) {
    const cmd = new BillingTopUp([], {} as any);
    cmd.parse = vi.fn().mockResolvedValue({
      flags: {
        product: "compute",
        "private-key": "0xdeadbeef",
        environment: "sepolia-dev",
        ...flags,
      },
    });
    cmd.log = vi.fn((...args: string[]) => logOutput.push(args.join(" ")));
    cmd.debug = vi.fn();
    cmd.error = vi.fn((msg: string) => {
      throw new Error(msg);
    }) as any;
    return cmd;
  }
```

For each existing test that passes `amount` as a flag, also add `method: "usdc"`. For example, the "happy path" test becomes:

```typescript
    const cmd = createCommand({ amount: "50", method: "usdc" });
```

Apply this change to all existing tests:
- "happy path: sufficient balance, purchase succeeds" → `{ amount: "50", method: "usdc" }`
- "zero USDC balance: exits with fund wallet message" → `{ amount: "50", method: "usdc" }`
- "below minimum purchase: shows error" → `{ amount: "5", method: "usdc" }`
- "--account flag: passes different address to topUp" → `{ amount: "50", method: "usdc", account: targetAccount }`
- "billing API poll timeout: shows timeout message" → `{ amount: "50", method: "usdc" }`
- "uses --amount flag when provided (skips prompt)" → `{ amount: "100", method: "usdc" }`
- "does not fail if status check errors" → `{ amount: "50", method: "usdc" }`

- [ ] **Step 4: Run existing USDC tests to make sure they still pass**

Run: `npx vitest run packages/cli/src/commands/billing/__tests__/top-up.test.ts`
Expected: All existing tests pass.

- [ ] **Step 5: Add credit card test — card on file, user accepts**

```typescript
  it("credit card: charges existing card on file", async () => {
    mockBilling.getStatus
      .mockResolvedValueOnce({ subscriptionStatus: "active", remainingCredits: 10.0 })
      .mockResolvedValueOnce({ subscriptionStatus: "active", remainingCredits: 35.0 });
    mockBilling.getPaymentMethods.mockResolvedValue({
      paymentMethods: [
        {
          id: "029641fc-3e5c-11f1-986c-5601121cbf6d",
          stripePaymentMethodId: "pm_1ABC1234",
          createdAt: "2026-04-20T15:00:00Z",
        },
      ],
    });
    mockBilling.purchaseCredits.mockResolvedValue({
      purchaseId: "a1b2c3d4",
      amountCents: "2500",
    });
    (confirm as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const cmd = createCommand({ amount: "25", method: "card" });
    const promise = cmd.run();
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(5_000);
    }
    await promise;
    const fullOutput = logOutput.join("\n");

    expect(mockBilling.purchaseCredits).toHaveBeenCalledWith(2500, "029641fc-3e5c-11f1-986c-5601121cbf6d");
    expect(fullOutput).toContain("Payment submitted");
    expect(fullOutput).toContain("Credits received");
  });
```

- [ ] **Step 6: Add credit card test — card on file, user declines (wants new card)**

```typescript
  it("credit card: opens checkout when user declines existing card", async () => {
    const openMock = (await import("open")).default as ReturnType<typeof vi.fn>;
    mockBilling.getStatus.mockResolvedValue({ subscriptionStatus: "active", remainingCredits: 10.0 });
    mockBilling.getPaymentMethods.mockResolvedValue({
      paymentMethods: [
        {
          id: "029641fc-3e5c-11f1-986c-5601121cbf6d",
          stripePaymentMethodId: "pm_1ABC1234",
          createdAt: "2026-04-20T15:00:00Z",
        },
      ],
    });
    mockBilling.purchaseCredits.mockResolvedValue({
      checkoutSessionId: "cs_test_abc123",
      checkoutUrl: "https://checkout.stripe.com/test",
      amountCents: "2500",
    });
    (confirm as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const cmd = createCommand({ amount: "25", method: "card" });
    const promise = cmd.run();
    await vi.advanceTimersByTimeAsync(200_000);
    await promise;
    const fullOutput = logOutput.join("\n");

    expect(mockBilling.purchaseCredits).toHaveBeenCalledWith(2500, undefined);
    expect(openMock).toHaveBeenCalledWith("https://checkout.stripe.com/test");
    expect(fullOutput).toContain("https://checkout.stripe.com/test");
  });
```

- [ ] **Step 7: Add credit card test — no card on file**

```typescript
  it("credit card: opens checkout when no card on file", async () => {
    const openMock = (await import("open")).default as ReturnType<typeof vi.fn>;
    mockBilling.getStatus.mockResolvedValue({ subscriptionStatus: "active", remainingCredits: 10.0 });
    mockBilling.getPaymentMethods.mockResolvedValue({ paymentMethods: [] });
    mockBilling.purchaseCredits.mockResolvedValue({
      checkoutSessionId: "cs_test_abc123",
      checkoutUrl: "https://checkout.stripe.com/test",
      amountCents: "5000",
    });

    const cmd = createCommand({ amount: "50", method: "card" });
    const promise = cmd.run();
    await vi.advanceTimersByTimeAsync(200_000);
    await promise;
    const fullOutput = logOutput.join("\n");

    expect(confirm).not.toHaveBeenCalled();
    expect(mockBilling.purchaseCredits).toHaveBeenCalledWith(5000, undefined);
    expect(openMock).toHaveBeenCalledWith("https://checkout.stripe.com/test");
    expect(fullOutput).toContain("https://checkout.stripe.com/test");
  });
```

- [ ] **Step 8: Add credit card test — amount below $5 minimum**

```typescript
  it("credit card: rejects amount below $5 minimum", async () => {
    mockBilling.getStatus.mockResolvedValue({ subscriptionStatus: "active", remainingCredits: 10.0 });

    const cmd = createCommand({ amount: "3", method: "card" });
    await expect(cmd.run()).rejects.toThrow("Minimum purchase is $5");
  });
```

- [ ] **Step 9: Add credit card test — `--method card --amount 50` skips prompts**

```typescript
  it("credit card: --method and --amount flags skip prompts", async () => {
    mockBilling.getStatus
      .mockResolvedValueOnce({ subscriptionStatus: "active", remainingCredits: 10.0 })
      .mockResolvedValueOnce({ subscriptionStatus: "active", remainingCredits: 60.0 });
    mockBilling.getPaymentMethods.mockResolvedValue({ paymentMethods: [] });
    mockBilling.purchaseCredits.mockResolvedValue({
      checkoutSessionId: "cs_test_abc123",
      checkoutUrl: "https://checkout.stripe.com/test",
      amountCents: "5000",
    });

    const cmd = createCommand({ amount: "50", method: "card" });
    const promise = cmd.run();
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(5_000);
    }
    await promise;

    expect(select).not.toHaveBeenCalled();
    expect(input).not.toHaveBeenCalled();
  });
```

- [ ] **Step 10: Run all tests**

Run: `npx vitest run packages/cli/src/commands/billing/__tests__/top-up.test.ts`
Expected: All tests pass (existing USDC tests + new credit card tests).

- [ ] **Step 11: Commit**

```bash
git add packages/cli/src/commands/billing/__tests__/top-up.test.ts
git commit -m "test(cli): add credit card flow tests for billing top-up"
```

---

## Task 6: Final verification

- [ ] **Step 1: Run full SDK type check**

Run: `npx tsc --noEmit -p packages/sdk/tsconfig.json`
Expected: Clean exit.

- [ ] **Step 2: Run full CLI type check**

Run: `npx tsc --noEmit -p packages/cli/tsconfig.json`
Expected: Clean exit.

- [ ] **Step 3: Run all billing tests**

Run: `npx vitest run packages/cli/src/commands/billing/__tests__/`
Expected: All tests pass.

- [ ] **Step 4: Commit any remaining fixes if needed**
