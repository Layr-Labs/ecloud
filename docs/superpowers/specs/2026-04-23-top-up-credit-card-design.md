# Top-Up Credit Card Support

Add credit card purchasing to `ecloud billing top-up` alongside the existing USDC on-chain flow.

## Motivation

We're moving to a credit-based burndown system. Users need to purchase credits, and not everyone wants to use USDC on-chain. Adding credit card support via Stripe lets users top up with a familiar payment method.

## API Routes

Both routes live on the billing API server (`ECLOUD_BILLING_API_URL`), use the same EIP-712 signature auth as existing routes (`Authorization: Bearer <sig>`, `X-Account`, `X-Expiry`).

### GET /v1/payment-methods

Returns saved payment methods for the authenticated wallet.

Request: no body, auth required.

Response:
```json
{
  "paymentMethods": [
    {
      "id": "029641fc-3e5c-11f1-986c-5601121cbf6d",
      "stripePaymentMethodId": "pm_1ABC123...",
      "createdAt": "2026-04-20T15:00:00Z"
    }
  ]
}
```

### POST /v1/credits/purchase

Two modes depending on whether `paymentMethodId` is provided.

**Direct charge (card on file):**

Request:
```json
{
  "amountCents": 5000,
  "paymentMethodId": "029641fc-3e5c-11f1-986c-5601121cbf6d"
}
```

Response:
```json
{
  "purchaseId": "a1b2c3d4-5e6f-11f1-986c-5601121cbf6d",
  "amountCents": "5000"
}
```

**Checkout session (no card on file):**

Request:
```json
{
  "amountCents": 5000
}
```

Response:
```json
{
  "checkoutSessionId": "cs_test_abc123...",
  "checkoutUrl": "https://checkout.stripe.com/c/pay/cs_test_abc123...",
  "amountCents": "5000"
}
```

Minimum `amountCents`: 500 ($5.00).

## Design

### SDK: New methods on `BillingApiClient`

File: `packages/sdk/src/client/common/utils/billingapi.ts`

Add two methods to the existing `BillingApiClient` class:

```typescript
async getPaymentMethods(): Promise<PaymentMethodsResponse>
```
- `GET ${billingApiServerURL}/v1/payment-methods`
- Uses `makeAuthenticatedRequest` with a dummy productId (e.g. `"compute"`) for signature generation since the auth scheme requires a product field.

```typescript
async purchaseCredits(amountCents: number, paymentMethodId?: string): Promise<CreditPurchaseResponse>
```
- `POST ${billingApiServerURL}/v1/credits/purchase`
- Body: `{ amountCents }` or `{ amountCents, paymentMethodId }` depending on whether a payment method is provided.
- Uses `makeAuthenticatedRequest`.

### SDK: New types

File: `packages/sdk/src/client/common/types/index.ts`

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

`CreditPurchaseResponse` is a union-style interface: a direct charge returns `purchaseId` without checkout fields; a checkout session returns `checkoutSessionId` + `checkoutUrl` without `purchaseId`.

### SDK: Export new methods from billing module

File: `packages/sdk/src/client/modules/billing/index.ts`

Expose the two new `BillingApiClient` methods through the `BillingModule` interface:

```typescript
export interface BillingModule {
  // ... existing methods ...
  getPaymentMethods: () => Promise<PaymentMethodsResponse>;
  purchaseCredits: (amountCents: number, paymentMethodId?: string) => Promise<CreditPurchaseResponse>;
}
```

Wire them to `billingApi.getPaymentMethods()` and `billingApi.purchaseCredits()` in `createBillingModule`.

### CLI: Modified `top-up.ts` command

File: `packages/cli/src/commands/billing/top-up.ts`

#### New flag

```
--method  usdc | card  (optional, prompts if omitted)
```

#### Updated flow

1. Show wallet address and current credit balance (unchanged).
2. **Payment method selection:**
   - If `--method usdc` -> go to USDC path.
   - If `--method card` -> go to credit card path.
   - If no flag -> prompt user to choose between "USDC (on-chain)" and "Credit card".
3. **USDC path:** Unchanged from current implementation (steps 2-5 in existing code).
4. **Credit card path:**
   a. Prompt for dollar amount (whole dollars, minimum $5). Skipped if `--amount` flag is provided.
   b. Convert to cents: `amountCents = dollars * 100`.
   c. Call `billing.getPaymentMethods()`.
   d. If payment methods exist:
      - Show: "Use card on file (pm_...1ABC)?" with yes/no prompt.
      - If yes: call `billing.purchaseCredits(amountCents, paymentMethod.id)`. This returns `{ purchaseId, amountCents }`. Proceed to poll for credits.
      - If no: call `billing.purchaseCredits(amountCents)` without payment method ID. This returns a checkout URL. Open in browser with `open`. Proceed to poll for credits.
   e. If no payment methods: call `billing.purchaseCredits(amountCents)` (no payment method ID). Open checkout URL in browser. Proceed to poll for credits.
5. **Credit polling:** Same polling loop as today — poll `billing.getStatus()` until `remainingCredits` increases or timeout (3 minutes).

#### Amount validation (credit card path)

- Must be a whole dollar amount (integer).
- Minimum: $5 (500 cents).
- No maximum (Stripe handles limits).

#### Non-interactive support

For CI/scripting, all prompts can be skipped via flags:
- `--method card --amount 50` skips the method and amount prompts.
- Without a card on file, the checkout URL is printed to stdout (the `open` call will be attempted but the URL is always logged).
- With a card on file and no flag to choose it, the command will still prompt. Full non-interactive card selection is out of scope for this change.

### CLI: Update command description and examples

Update `static description` and `static examples` to reflect the new credit card option.

### Tests

File: `packages/cli/src/commands/billing/__tests__/top-up.test.ts`

Add test cases:
- **Credit card, card on file, user accepts:** mock `getPaymentMethods` returning one card, mock `purchaseCredits` returning `{ purchaseId, amountCents }`, verify no browser open, verify credit polling.
- **Credit card, card on file, user declines (wants new card):** mock `purchaseCredits` returning `{ checkoutUrl, ... }`, verify `open` is called with checkout URL.
- **Credit card, no card on file:** mock `getPaymentMethods` returning empty array, mock `purchaseCredits` returning checkout URL, verify `open` is called.
- **`--method card --amount 50` skips prompts:** verify `select` and `input` are not called.
- **Amount below $5 minimum:** verify validation error.
- **Existing USDC tests remain unchanged.**

Mock `billing.getPaymentMethods` and `billing.purchaseCredits` on the same `mockBilling` object used by existing tests. Mock `open` as already done in `subscribe.test.ts`.

## Files changed

| File | Change |
|------|--------|
| `packages/sdk/src/client/common/types/index.ts` | Add `PaymentMethod`, `PaymentMethodsResponse`, `CreditPurchaseResponse` |
| `packages/sdk/src/client/common/utils/billingapi.ts` | Add `getPaymentMethods()`, `purchaseCredits()` |
| `packages/sdk/src/client/modules/billing/index.ts` | Expose new methods on `BillingModule` |
| `packages/cli/src/commands/billing/top-up.ts` | Add `--method` flag, credit card flow, method selection prompt |
| `packages/cli/src/commands/billing/__tests__/top-up.test.ts` | Add credit card test cases |

## Out of scope

- Listing/managing saved payment methods (separate command later).
- Deleting payment methods.
- Full non-interactive card selection (auto-picking a saved card without prompting).
- Changing the subscribe command flow.
