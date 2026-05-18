# Admin & Coupon CLI Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `admin` command group (coupons + admins management) and a `billing redeem-coupon` command for users to redeem coupon codes for credits.

**Architecture:** The billing API server already exposes admin (`/admin/coupons`, `/admin/admins`) and user-facing coupon (`/v1/coupons/redeem`) REST endpoints authenticated via EIP-712 signatures. We'll extend `BillingApiClient` in the SDK with these endpoint methods, create a new `AdminModule` in the SDK, add `redeemCoupon` to the existing `BillingModule`, then add CLI commands following the established oclif pattern.

**Tech Stack:** TypeScript, oclif, viem (EIP-712 signatures), axios (HTTP), @inquirer/prompts, chalk

---

### Task 1: Add Admin & Coupon API Methods to BillingApiClient

**Files:**
- Modify: `packages/sdk/src/client/common/utils/billingapi.ts`
- Modify: `packages/sdk/src/client/common/types/index.ts` (or wherever billing types live)

- [ ] **Step 1: Add types for admin and coupon API responses**

First, find where billing types are defined:

Run: `grep -r "ProductSubscriptionResponse" packages/sdk/src/client/common/types/ --include="*.ts" -l`

Then add these types to the types file:

```typescript
// Admin - Coupon types
export interface AdminCoupon {
  id: string;
  amountCents: number;
  active: boolean;
  redeemedBy: string;
  redeemedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface CreateCouponResponse {
  coupon: AdminCoupon;
}

export interface ListCouponsResponse {
  coupons: AdminCoupon[];
  total: number;
}

export interface GetCouponResponse {
  coupon: AdminCoupon;
}

// Admin - Admin management types
export interface AdminUser {
  id: string;
  address: string;
  createdAt: string;
}

export interface AddAdminResponse {
  admin: AdminUser;
}

export interface ListAdminsResponse {
  admins: AdminUser[];
}

// User-facing coupon redemption
export interface RedeemCouponResponse {
  amountCents: number;
}
```

- [ ] **Step 2: Add admin and coupon methods to BillingApiClient**

Add the following methods to `packages/sdk/src/client/common/utils/billingapi.ts`:

```typescript
// ========================================================================
// Admin - Coupon Methods
// ========================================================================

async createCoupon(amountCents: number): Promise<CreateCouponResponse> {
  const endpoint = `${this.config.billingApiServerURL}/admin/coupons`;
  const resp = await this.makeAuthenticatedRequest(endpoint, "POST", "compute", { amountCents });
  return resp.json();
}

async listCoupons(opts?: { offset?: number; limit?: number; active?: boolean; redeemed?: boolean }): Promise<ListCouponsResponse> {
  const params = new URLSearchParams();
  if (opts?.offset !== undefined) params.set("offset", opts.offset.toString());
  if (opts?.limit !== undefined) params.set("limit", opts.limit.toString());
  if (opts?.active !== undefined) params.set("active", opts.active.toString());
  if (opts?.redeemed !== undefined) params.set("redeemed", opts.redeemed.toString());
  const qs = params.toString();
  const endpoint = `${this.config.billingApiServerURL}/admin/coupons${qs ? `?${qs}` : ""}`;
  const resp = await this.makeAuthenticatedRequest(endpoint, "GET", "compute");
  return resp.json();
}

async getCoupon(id: string): Promise<GetCouponResponse> {
  const endpoint = `${this.config.billingApiServerURL}/admin/coupons/${id}`;
  const resp = await this.makeAuthenticatedRequest(endpoint, "GET", "compute");
  return resp.json();
}

async deactivateCoupon(id: string): Promise<void> {
  const endpoint = `${this.config.billingApiServerURL}/admin/coupons/${id}/deactivate`;
  await this.makeAuthenticatedRequest(endpoint, "POST", "compute");
}

async redeemCouponForUser(id: string, address: string): Promise<void> {
  const endpoint = `${this.config.billingApiServerURL}/admin/coupons/${id}/redeem`;
  await this.makeAuthenticatedRequest(endpoint, "POST", "compute", { address });
}

// ========================================================================
// Admin - Admin Management Methods
// ========================================================================

async addAdmin(address: string): Promise<AddAdminResponse> {
  const endpoint = `${this.config.billingApiServerURL}/admin/admins`;
  const resp = await this.makeAuthenticatedRequest(endpoint, "POST", "compute", { address });
  return resp.json();
}

async removeAdmin(address: string): Promise<void> {
  const endpoint = `${this.config.billingApiServerURL}/admin/admins/${address}`;
  await this.makeAuthenticatedRequest(endpoint, "DELETE", "compute");
}

async listAdmins(): Promise<ListAdminsResponse> {
  const endpoint = `${this.config.billingApiServerURL}/admin/admins`;
  const resp = await this.makeAuthenticatedRequest(endpoint, "GET", "compute");
  return resp.json();
}

// ========================================================================
// User - Coupon Redemption
// ========================================================================

async redeemCoupon(code: string): Promise<RedeemCouponResponse> {
  const endpoint = `${this.config.billingApiServerURL}/v1/coupons/redeem`;
  const resp = await this.makeAuthenticatedRequest(endpoint, "POST", "compute", { code });
  return resp.json();
}
```

- [ ] **Step 3: Run typecheck to verify**

Run: `cd /Users/seanmcgary/Code/ecloud && pnpm --filter @layr-labs/ecloud-sdk run typecheck`
Expected: PASS (no type errors)

- [ ] **Step 4: Commit**

```bash
git add packages/sdk/src/client/common/utils/billingapi.ts packages/sdk/src/client/common/types/
git commit -m "feat(sdk): add admin and coupon API methods to BillingApiClient"
```

---

### Task 2: Create AdminModule in the SDK

**Files:**
- Create: `packages/sdk/src/client/modules/admin/index.ts`
- Modify: `packages/sdk/src/client/index.ts`
- Modify: `packages/cli/src/client.ts`

- [ ] **Step 1: Create the AdminModule**

Create `packages/sdk/src/client/modules/admin/index.ts`:

```typescript
import type { WalletClient, PublicClient, Address } from "viem";
import { BillingApiClient } from "../../common/utils/billingapi";
import { getBillingEnvironmentConfig, getBuildType } from "../../common/config/environment";
import type {
  AdminCoupon,
  CreateCouponResponse,
  ListCouponsResponse,
  GetCouponResponse,
  AdminUser,
  AddAdminResponse,
  ListAdminsResponse,
} from "../../common/types";

export interface AdminModule {
  address: Address;
  createCoupon: (amountCents: number) => Promise<CreateCouponResponse>;
  listCoupons: (opts?: { offset?: number; limit?: number; active?: boolean; redeemed?: boolean }) => Promise<ListCouponsResponse>;
  getCoupon: (id: string) => Promise<GetCouponResponse>;
  deactivateCoupon: (id: string) => Promise<void>;
  redeemCouponForUser: (id: string, address: string) => Promise<void>;
  addAdmin: (address: string) => Promise<AddAdminResponse>;
  removeAdmin: (address: string) => Promise<void>;
  listAdmins: () => Promise<ListAdminsResponse>;
}

export interface AdminModuleConfig {
  verbose?: boolean;
  walletClient: WalletClient;
  publicClient: PublicClient;
  environment: string;
}

export function createAdminModule(config: AdminModuleConfig): AdminModule {
  const { verbose = false, walletClient } = config;

  if (!walletClient.account) {
    throw new Error("WalletClient must have an account attached");
  }
  const address = walletClient.account.address as Address;

  const billingEnvConfig = getBillingEnvironmentConfig(getBuildType());
  const billingApi = new BillingApiClient(billingEnvConfig, walletClient, { verbose });

  return {
    address,

    async createCoupon(amountCents: number) {
      return billingApi.createCoupon(amountCents);
    },

    async listCoupons(opts?) {
      return billingApi.listCoupons(opts);
    },

    async getCoupon(id: string) {
      return billingApi.getCoupon(id);
    },

    async deactivateCoupon(id: string) {
      return billingApi.deactivateCoupon(id);
    },

    async redeemCouponForUser(id: string, userAddress: string) {
      return billingApi.redeemCouponForUser(id, userAddress);
    },

    async addAdmin(adminAddress: string) {
      return billingApi.addAdmin(adminAddress);
    },

    async removeAdmin(adminAddress: string) {
      return billingApi.removeAdmin(adminAddress);
    },

    async listAdmins() {
      return billingApi.listAdmins();
    },
  };
}
```

- [ ] **Step 2: Export AdminModule from SDK index**

Add to `packages/sdk/src/client/index.ts`:

```typescript
export {
  createAdminModule,
  type AdminModule,
  type AdminModuleConfig,
} from "./modules/admin";
```

- [ ] **Step 3: Add `redeemCoupon` to the BillingModule interface and implementation**

In `packages/sdk/src/client/modules/billing/index.ts`, add to the `BillingModule` interface:

```typescript
redeemCoupon: (code: string) => Promise<RedeemCouponResponse>;
```

And in the `createBillingModule` function's returned module object:

```typescript
async redeemCoupon(code: string) {
  return billingApi.redeemCoupon(code);
},
```

Import `RedeemCouponResponse` from the types file.

- [ ] **Step 4: Add `createAdminClient` to the CLI's client.ts**

Add to `packages/cli/src/client.ts`:

```typescript
import {
  createComputeModule,
  createBillingModule,
  createBuildModule,
  createAdminModule,
  getEnvironmentConfig,
  requirePrivateKey,
} from "@layr-labs/ecloud-sdk";

// ... existing code ...

export async function createAdminClient(flags: CommonFlags) {
  flags = await validateCommonFlags(flags);

  const environment = flags.environment;
  const environmentConfig = getEnvironmentConfig(environment);
  const rpcUrl = flags["rpc-url"] || environmentConfig.billingRPCURL || environmentConfig.defaultRPCURL;
  const { key: privateKey, source } = await requirePrivateKey({
    privateKey: flags["private-key"],
  });

  if (flags.verbose) {
    console.log(`Using private key from: ${source}`);
  }

  const { walletClient, publicClient } = createViemClients({
    privateKey: privateKey as Hex,
    rpcUrl,
    environment,
  });

  return createAdminModule({
    verbose: flags.verbose,
    walletClient,
    publicClient,
    environment,
  });
}
```

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/seanmcgary/Code/ecloud && pnpm --filter @layr-labs/ecloud-sdk run typecheck && pnpm --filter @layr-labs/ecloud-cli run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/client/modules/admin/ packages/sdk/src/client/index.ts packages/sdk/src/client/modules/billing/index.ts packages/cli/src/client.ts
git commit -m "feat(sdk): add AdminModule and redeemCoupon to BillingModule"
```

---

### Task 3: Add `billing redeem-coupon` CLI Command

**Files:**
- Create: `packages/cli/src/commands/billing/redeem-coupon.ts`

- [ ] **Step 1: Create the redeem-coupon command**

Create `packages/cli/src/commands/billing/redeem-coupon.ts`:

```typescript
import { Command, Flags } from "@oclif/core";
import { createBillingClient } from "../../client";
import { commonFlags } from "../../flags";
import chalk from "chalk";
import { withTelemetry } from "../../telemetry";
import { input } from "@inquirer/prompts";

export default class BillingRedeemCoupon extends Command {
  static description = "Redeem a coupon code for credits";

  static examples = [
    "<%= config.bin %> billing redeem-coupon",
    "<%= config.bin %> billing redeem-coupon --code ABC123",
  ];

  static flags = {
    ...commonFlags,
    code: Flags.string({
      required: false,
      description: "Coupon code to redeem",
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(BillingRedeemCoupon);
      const billing = await createBillingClient(flags);

      const code =
        flags.code ??
        (await input({
          message: "Enter your coupon code:",
          validate: (val) => (val.trim().length > 0 ? true : "Coupon code is required"),
        }));

      const result = await billing.redeemCoupon(code.trim());
      const dollars = (result.amountCents / 100).toFixed(2);

      this.log(`\n  ${chalk.green("✓")} Coupon redeemed! ${chalk.cyan(`$${dollars}`)} in credits added to your account.`);
      this.log(`\n  Run ${chalk.cyan("ecloud billing status")} to see your updated balance.\n`);
    });
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/seanmcgary/Code/ecloud && pnpm --filter @layr-labs/ecloud-cli run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/commands/billing/redeem-coupon.ts
git commit -m "feat(cli): add billing redeem-coupon command"
```

---

### Task 4: Add `admin coupons` CLI Commands

**Files:**
- Create: `packages/cli/src/commands/admin/coupons/create.ts`
- Create: `packages/cli/src/commands/admin/coupons/list.ts`
- Create: `packages/cli/src/commands/admin/coupons/get.ts`
- Create: `packages/cli/src/commands/admin/coupons/deactivate.ts`
- Create: `packages/cli/src/commands/admin/coupons/redeem.ts`

- [ ] **Step 1: Create `admin coupons create`**

Create `packages/cli/src/commands/admin/coupons/create.ts`:

```typescript
import { Command, Flags } from "@oclif/core";
import { createAdminClient } from "../../../client";
import { commonFlags } from "../../../flags";
import chalk from "chalk";
import { withTelemetry } from "../../../telemetry";
import { input } from "@inquirer/prompts";

export default class AdminCouponsCreate extends Command {
  static description = "Create a new coupon";

  static examples = [
    "<%= config.bin %> admin coupons create --amount 50",
  ];

  static flags = {
    ...commonFlags,
    amount: Flags.string({
      required: false,
      description: "Coupon value in whole dollars",
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(AdminCouponsCreate);
      const admin = await createAdminClient(flags);

      const amountStr =
        flags.amount ??
        (await input({
          message: "Coupon value in dollars:",
          validate: (val) => {
            const n = parseFloat(val);
            if (isNaN(n) || n <= 0) return "Enter a positive number";
            return true;
          },
        }));

      const dollars = parseFloat(amountStr);
      const amountCents = Math.round(dollars * 100);

      const { coupon } = await admin.createCoupon(amountCents);

      this.log(`\n${chalk.green("✓")} Coupon created`);
      this.log(`  ID:     ${chalk.cyan(coupon.id)}`);
      this.log(`  Value:  ${chalk.cyan(`$${(coupon.amountCents / 100).toFixed(2)}`)}`);
      this.log(`  Active: ${coupon.active ? chalk.green("yes") : chalk.red("no")}\n`);
    });
  }
}
```

- [ ] **Step 2: Create `admin coupons list`**

Create `packages/cli/src/commands/admin/coupons/list.ts`:

```typescript
import { Command, Flags } from "@oclif/core";
import { createAdminClient } from "../../../client";
import { commonFlags } from "../../../flags";
import chalk from "chalk";
import { withTelemetry } from "../../../telemetry";

export default class AdminCouponsList extends Command {
  static description = "List coupons";

  static examples = [
    "<%= config.bin %> admin coupons list",
    "<%= config.bin %> admin coupons list --active",
    "<%= config.bin %> admin coupons list --redeemed",
  ];

  static flags = {
    ...commonFlags,
    active: Flags.boolean({
      required: false,
      description: "Filter to active coupons only",
    }),
    redeemed: Flags.boolean({
      required: false,
      description: "Filter to redeemed coupons only",
    }),
    limit: Flags.integer({
      required: false,
      description: "Number of results to return",
      default: 25,
    }),
    offset: Flags.integer({
      required: false,
      description: "Offset for pagination",
      default: 0,
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(AdminCouponsList);
      const admin = await createAdminClient(flags);

      const opts: { offset?: number; limit?: number; active?: boolean; redeemed?: boolean } = {
        offset: flags.offset,
        limit: flags.limit,
      };
      if (flags.active) opts.active = true;
      if (flags.redeemed) opts.redeemed = true;

      const { coupons, total } = await admin.listCoupons(opts);

      if (coupons.length === 0) {
        this.log("\n  No coupons found.\n");
        return;
      }

      this.log(`\n${chalk.bold("Coupons")} (${coupons.length} of ${total}):\n`);

      for (const c of coupons) {
        const value = `$${(c.amountCents / 100).toFixed(2)}`;
        const status = c.redeemedBy
          ? chalk.gray(`redeemed by ${c.redeemedBy}`)
          : c.active
            ? chalk.green("active")
            : chalk.red("inactive");
        this.log(`  ${chalk.cyan(c.id)}  ${value}  ${status}`);
      }
      this.log();
    });
  }
}
```

- [ ] **Step 3: Create `admin coupons get`**

Create `packages/cli/src/commands/admin/coupons/get.ts`:

```typescript
import { Args, Command } from "@oclif/core";
import { createAdminClient } from "../../../client";
import { commonFlags } from "../../../flags";
import chalk from "chalk";
import { withTelemetry } from "../../../telemetry";

export default class AdminCouponsGet extends Command {
  static description = "Get details of a coupon";

  static examples = [
    "<%= config.bin %> admin coupons get <coupon-id>",
  ];

  static args = {
    id: Args.string({ description: "Coupon ID", required: true }),
  };

  static flags = {
    ...commonFlags,
  };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(AdminCouponsGet);
      const admin = await createAdminClient(flags);

      const { coupon } = await admin.getCoupon(args.id);

      this.log(`\n${chalk.bold("Coupon Details:")}`);
      this.log(`  ID:         ${chalk.cyan(coupon.id)}`);
      this.log(`  Value:      ${chalk.cyan(`$${(coupon.amountCents / 100).toFixed(2)}`)}`);
      this.log(`  Active:     ${coupon.active ? chalk.green("yes") : chalk.red("no")}`);
      this.log(`  Created by: ${coupon.createdBy}`);
      this.log(`  Created at: ${coupon.createdAt}`);
      if (coupon.redeemedBy) {
        this.log(`  Redeemed by: ${coupon.redeemedBy}`);
        this.log(`  Redeemed at: ${coupon.redeemedAt}`);
      }
      this.log();
    });
  }
}
```

- [ ] **Step 4: Create `admin coupons deactivate`**

Create `packages/cli/src/commands/admin/coupons/deactivate.ts`:

```typescript
import { Args, Command } from "@oclif/core";
import { createAdminClient } from "../../../client";
import { commonFlags } from "../../../flags";
import chalk from "chalk";
import { withTelemetry } from "../../../telemetry";

export default class AdminCouponsDeactivate extends Command {
  static description = "Deactivate a coupon";

  static examples = [
    "<%= config.bin %> admin coupons deactivate <coupon-id>",
  ];

  static args = {
    id: Args.string({ description: "Coupon ID", required: true }),
  };

  static flags = {
    ...commonFlags,
  };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(AdminCouponsDeactivate);
      const admin = await createAdminClient(flags);

      await admin.deactivateCoupon(args.id);

      this.log(`\n  ${chalk.green("✓")} Coupon ${chalk.cyan(args.id)} deactivated.\n`);
    });
  }
}
```

- [ ] **Step 5: Create `admin coupons redeem`**

Create `packages/cli/src/commands/admin/coupons/redeem.ts`:

```typescript
import { Args, Command, Flags } from "@oclif/core";
import { createAdminClient } from "../../../client";
import { commonFlags } from "../../../flags";
import chalk from "chalk";
import { withTelemetry } from "../../../telemetry";

export default class AdminCouponsRedeem extends Command {
  static description = "Redeem a coupon for a user (admin action)";

  static examples = [
    "<%= config.bin %> admin coupons redeem <coupon-id> --address 0x...",
  ];

  static args = {
    id: Args.string({ description: "Coupon ID", required: true }),
  };

  static flags = {
    ...commonFlags,
    address: Flags.string({
      required: true,
      description: "User wallet address to redeem coupon for",
    }),
  };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(AdminCouponsRedeem);
      const admin = await createAdminClient(flags);

      await admin.redeemCouponForUser(args.id, flags.address);

      this.log(`\n  ${chalk.green("✓")} Coupon ${chalk.cyan(args.id)} redeemed for ${chalk.cyan(flags.address)}.\n`);
    });
  }
}
```

- [ ] **Step 6: Run typecheck**

Run: `cd /Users/seanmcgary/Code/ecloud && pnpm --filter @layr-labs/ecloud-cli run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/admin/coupons/
git commit -m "feat(cli): add admin coupons commands (create, list, get, deactivate, redeem)"
```

---

### Task 5: Add `admin admins` CLI Commands

**Files:**
- Create: `packages/cli/src/commands/admin/admins/add.ts`
- Create: `packages/cli/src/commands/admin/admins/remove.ts`
- Create: `packages/cli/src/commands/admin/admins/list.ts`

- [ ] **Step 1: Create `admin admins add`**

Create `packages/cli/src/commands/admin/admins/add.ts`:

```typescript
import { Args, Command } from "@oclif/core";
import { createAdminClient } from "../../../client";
import { commonFlags } from "../../../flags";
import chalk from "chalk";
import { withTelemetry } from "../../../telemetry";

export default class AdminAdminsAdd extends Command {
  static description = "Add a new admin";

  static examples = [
    "<%= config.bin %> admin admins add 0x...",
  ];

  static args = {
    address: Args.string({ description: "Wallet address to grant admin", required: true }),
  };

  static flags = {
    ...commonFlags,
  };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(AdminAdminsAdd);
      const admin = await createAdminClient(flags);

      const { admin: newAdmin } = await admin.addAdmin(args.address);

      this.log(`\n  ${chalk.green("✓")} Admin added`);
      this.log(`  Address: ${chalk.cyan(newAdmin.address)}`);
      this.log(`  ID:      ${newAdmin.id}\n`);
    });
  }
}
```

- [ ] **Step 2: Create `admin admins remove`**

Create `packages/cli/src/commands/admin/admins/remove.ts`:

```typescript
import { Args, Command } from "@oclif/core";
import { createAdminClient } from "../../../client";
import { commonFlags } from "../../../flags";
import chalk from "chalk";
import { withTelemetry } from "../../../telemetry";

export default class AdminAdminsRemove extends Command {
  static description = "Remove an admin";

  static examples = [
    "<%= config.bin %> admin admins remove 0x...",
  ];

  static args = {
    address: Args.string({ description: "Wallet address to remove from admins", required: true }),
  };

  static flags = {
    ...commonFlags,
  };

  async run() {
    return withTelemetry(this, async () => {
      const { args, flags } = await this.parse(AdminAdminsRemove);
      const admin = await createAdminClient(flags);

      await admin.removeAdmin(args.address);

      this.log(`\n  ${chalk.green("✓")} Admin ${chalk.cyan(args.address)} removed.\n`);
    });
  }
}
```

- [ ] **Step 3: Create `admin admins list`**

Create `packages/cli/src/commands/admin/admins/list.ts`:

```typescript
import { Command } from "@oclif/core";
import { createAdminClient } from "../../../client";
import { commonFlags } from "../../../flags";
import chalk from "chalk";
import { withTelemetry } from "../../../telemetry";

export default class AdminAdminsList extends Command {
  static description = "List all admins";

  static examples = [
    "<%= config.bin %> admin admins list",
  ];

  static flags = {
    ...commonFlags,
  };

  async run() {
    return withTelemetry(this, async () => {
      const { flags } = await this.parse(AdminAdminsList);
      const admin = await createAdminClient(flags);

      const { admins } = await admin.listAdmins();

      if (admins.length === 0) {
        this.log("\n  No admins found.\n");
        return;
      }

      this.log(`\n${chalk.bold("Admins")} (${admins.length}):\n`);
      for (const a of admins) {
        this.log(`  ${chalk.cyan(a.address)}  ${chalk.gray(a.createdAt)}`);
      }
      this.log();
    });
  }
}
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/seanmcgary/Code/ecloud && pnpm --filter @layr-labs/ecloud-cli run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/admin/admins/
git commit -m "feat(cli): add admin admins commands (add, remove, list)"
```

---

### Task 6: Register `admin` Topics in package.json

**Files:**
- Modify: `packages/cli/package.json`

- [ ] **Step 1: Add admin topics to oclif config**

In `packages/cli/package.json`, add to the `oclif.topics` object:

```json
"admin": {
  "description": "Admin operations (requires admin privileges)"
},
"admin:coupons": {
  "description": "Manage coupons"
},
"admin:admins": {
  "description": "Manage admin users"
}
```

- [ ] **Step 2: Verify CLI discovers commands**

Run: `cd /Users/seanmcgary/Code/ecloud/packages/cli && pnpm run build && node bin/run.js admin --help`
Expected: Shows admin topic with coupons and admins sub-topics

Run: `node bin/run.js admin coupons --help`
Expected: Lists create, list, get, deactivate, redeem commands

Run: `node bin/run.js billing redeem-coupon --help`
Expected: Shows redeem-coupon command help

- [ ] **Step 3: Commit**

```bash
git add packages/cli/package.json
git commit -m "feat(cli): register admin topics in oclif config"
```

---

### Task 7: Export New Types from SDK

**Files:**
- Modify: `packages/sdk/src/client/index.ts`

- [ ] **Step 1: Ensure all new types are exported from SDK entrypoint**

Verify that `RedeemCouponResponse` is exported via the existing `export * from "./common/types"` line. If admin types need explicit export (because they're in a new file), add:

```typescript
export type {
  AdminCoupon,
  CreateCouponResponse,
  ListCouponsResponse,
  GetCouponResponse,
  AdminUser,
  AddAdminResponse,
  ListAdminsResponse,
  RedeemCouponResponse,
} from "./common/types";
```

Also export `RedeemCouponResponse` from the billing module exports if needed:

```typescript
export {
  createBillingModule,
  type BillingModule,
  type BillingModuleConfig,
  type BillingChain,
  type TopUpOpts,
  type TopUpResult,
  type TopUpInfo,
} from "./modules/billing";
```

- [ ] **Step 2: Final full typecheck and build**

Run: `cd /Users/seanmcgary/Code/ecloud && pnpm --filter @layr-labs/ecloud-sdk run typecheck && pnpm --filter @layr-labs/ecloud-cli run typecheck && pnpm --filter @layr-labs/ecloud-cli run build`
Expected: All pass

- [ ] **Step 3: Commit if any changes**

```bash
git add packages/sdk/src/client/index.ts
git commit -m "feat(sdk): export admin and coupon types"
```
