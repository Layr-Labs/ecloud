# Top-Up x402 Support

Add an `x402` payment method to `ecloud billing top-up`, alongside the existing
`usdc` (on-chain) and `card` (Stripe) methods. The x402 method settles a USDC
payment over the [x402 protocol](https://www.x402.org/) against a new
ecloud-platform HTTP endpoint — no platform hot wallet, no on-chain
`purchaseCreditsFor` call from the user.

## Context

The ecloud-platform PR
[Layr-Labs/ecloud-platform#272](https://github.com/Layr-Labs/ecloud-platform/pull/272)
adds an x402 USDC credit-purchase path on the **server** side (a hand-written
HTTP handler outside the proto-only grpc-gateway routing), plus an equivalent
`top-up --method x402` to the **Go** CLI that lives in that same monorepo
(`ecloud-platform/ecloud-cli`).

This repo (`ecloud`) is the separate **TypeScript** SDK + CLI
(`packages/sdk`, `packages/cli`). This change is the TypeScript-CLI equivalent
of PR #272's CLI work: wire `ec billing top-up` to the new platform endpoint so
TypeScript-CLI users get the same x402 option.

The server (from the current ecloud-platform tree) exposes **two** routes with
identical request/response payloads:

- `POST /apps/{appId}/x402-credits` — credits a specific app's isolated billing.
- `POST /creators/{creatorAddr}/x402-credits` — credits a creator's shared pool.

## The x402 flow (two-phase, server-driven)

The endpoint implements the canonical x402 challenge/response handshake:

1. **Challenge.** Client `POST`s `{ "amountCents": <int> }` with **no** payment
   header. Server creates a pending purchase row and replies `402 Payment
   Required` with an x402 `PaymentRequired` body:
   ```json
   {
     "x402Version": 2,
     "accepts": [
       {
         "scheme": "exact",
         "network": "eip155:84532",
         "amount": "5000000",
         "asset": "0x<usdc-contract>",
         "payTo": "0x<platform-receiving-addr>",
         "maxTimeoutSeconds": 60,
         "extra": { "paymentId": "pay_<uuid>" }
       }
     ],
     "extensions": { "appId": "0x..", "amountCents": 500 }
   }
   ```
   - `amount` is USDC atomic units: `cents * 10_000` (USDC has 6 decimals, cents
     have 2). `500` cents ($5) → `"5000000"`.
   - `network` is **CAIP-2** (`eip155:84532` Base Sepolia, `eip155:8453` Base
     mainnet) — set per-environment by server config.
   - `extra.paymentId` ties the challenge to the pending row and **must** be
     echoed back in the signed payload.

2. **Signed retry.** Client signs an `exact`-scheme EVM authorization
   (EIP-3009 `transferWithAuthorization` over USDC) matching the requirements,
   base64-encodes the x402 `PaymentPayload` JSON, and re-sends the same `POST`
   with an `X-PAYMENT: <base64>` header. The payload's `accepted.extra.paymentId`
   carries the `paymentId` from phase 1.

3. **Verify + settle + credit.** Server verifies and settles via the Coinbase
   CDP facilitator, credits the billing ledger, and replies `201 Created`:
   ```json
   {
     "targetType": "app",
     "targetAddress": "0x..",
     "creditedCents": 500,
     "paymentId": "pay_...",
     "txHash": "0x..."
   }
   ```
   plus an `X-PAYMENT-RESPONSE: <base64>` settlement-receipt header
   (`{ "success": true, "transaction": "0x..", "paymentId": "pay_.." }`).

The server **never trusts the client's echoed requirements** — it rebuilds them
from the pending row before verify/settle. Settlement is itself the proof of
payment: the endpoint has **no account-ownership auth gate**, by design, so any
payer can fund any app/creator by address.

### Server error taxonomy (status → meaning)

| Status | Meaning |
|--------|---------|
| `400` | invalid/`<=0` amount, below minimum, or payload missing `paymentId` |
| `404` | app/creator not found, or no pending purchase for `paymentId` |
| `409` | amount or target mismatch vs. the pending row |
| `402` (after signing) | payment verification failed / pending expired |
| `502` | settlement failed at the facilitator |
| `201` | success |

Minimum purchase is **$5 (500 cents)**, matching the card path.

## Why a hand-rolled x402 client (not a published lib)

There is **no `x402-foundation` TypeScript client on npm** — the server uses the
Go `github.com/x402-foundation/x402/go` library, which emits the canonical
x402.org wire format (`X-PAYMENT` header, `x402Version: 2`, CAIP-2 networks,
`exact` EVM scheme). Coinbase publishes the only TS clients, and **each
mismatches the foundation server in a different way**:

- `x402-fetch` / `x402-axios` **v1.x**: correct `X-PAYMENT` header, but uses v1
  network names (`base-sepolia`) and `x402Version: 1` — incompatible with the
  version-2 server — and drags in Solana/wagmi transitive deps.
- `@x402/fetch` / `@x402/evm` **v2.x**: correct CAIP-2 + version 2, but renamed
  the request header to `PAYMENT-SIGNATURE` (server reads `X-PAYMENT`).

**Confirmed from the pinned foundation source** (`x402-foundation/x402/go` @
`45d81d46`): the ecloud-platform handler reads the **`X-PAYMENT`** header and its
CORS config allows only `X-Payment` / exposes `X-Payment-Response` — yet the
challenge it emits is `x402Version: 2` with CAIP-2 networks. The foundation Go
HTTP *client* sends v2 payloads under `PAYMENT-SIGNATURE`, so even the
foundation's own TS-less client wouldn't match this server over HTTP. The
correct payload is therefore a **v2-shaped `PaymentPayload` JSON, base64'd, under
the `X-PAYMENT` header** — the exact hybrid the hand-rolled client produces.

### Pinned wire contract (from foundation source)

`X-PAYMENT` = `base64(JSON.stringify(paymentPayload))` where:

```jsonc
{
  "x402Version": 2,
  "payload": {                       // ExactEIP3009Payload.ToMap()
    "signature": "0x<65-byte sig>",
    "authorization": {               // all decimal/hex STRINGS
      "from": "0x<signer>",
      "to": "0x<payTo>",
      "value": "5000000",            // = accepts[0].amount, verbatim
      "validAfter": "<now-600>",
      "validBefore": "<now+3600>",
      "nonce": "0x<32 random bytes>"
    }
  },
  "accepted": { /* accepts[0] echoed verbatim, incl. extra.paymentId */ }
}
```

EIP-712 signing (`exact` EIP-3009 scheme):
- **domain**: `{ name, version, chainId, verifyingContract: <asset> }`.
  `chainId` is parsed from the CAIP-2 `network` (`eip155:<id>`). `name`/`version`
  come from `accepts[0].extra.name`/`.version` if present, else a per-network
  USDC table: `eip155:84532` → `{ name: "USDC", version: "2" }` (Base Sepolia),
  `eip155:8453` → `{ name: "USD Coin", version: "2" }` (Base mainnet).
- **types**: `TransferWithAuthorization: [from address, to address, value
  uint256, validAfter uint256, validBefore uint256, nonce bytes32]` (do **not**
  include `EIP712Domain` in the viem `types` map — viem derives it).
- **message** (viem value types): `from`/`to` = addresses, `value`/`validAfter`/
  `validBefore` = `bigint`, `nonce` = `0x`-hex (bytes32).
- **validity window**: `validAfter = now - 600`, `validBefore = now + 3600`
  (mirrors the foundation client's 10-min back-buffer + 1-hour window; the
  challenge's `maxTimeoutSeconds` is a server/facilitator concern, not the
  authorization window).

The signed `value`/`validAfter`/`validBefore` are emitted as **decimal strings**
in `payload.authorization`; `nonce` as a `0x` hex string. The client never
recomputes `amount` — it signs `accepts[0].amount` verbatim. This keeps the x402
path **RPC-free** (no on-chain reads): the per-network USDC name/version table
replaces an on-chain `name()`/`version()` lookup.

Rather than depend on a near-miss client and fight its header/network
assumptions, we hand-roll a **minimal** x402 client using `viem` (already a
dependency). The `exact` EVM scheme is a single EIP-712 `signTypedData` call
(USDC `TransferWithAuthorization`), and the payload/header construction is a few
dozen lines. This gives exact control over the wire format, adds **zero new
heavy dependencies**, and keeps the money-moving code auditable in one file.

**Compatibility risk is accepted and deferred to end-to-end verification**
against the `sepolia-dev` endpoint (see Verification). The payload shape below is
built to the documented foundation contract; if the live endpoint rejects it,
the fix is localized to the one client module.

## Design

All logic is **CLI-only** (the SDK billing module is untouched), consistent with
the decision to keep x402 out of the SDK surface for now. The CLI already builds
a wallet (private key + address) via `createBillingClient(flags)`; x402 reuses
that wallet as the payment signer.

### New file: `packages/cli/src/x402/client.ts`

A self-contained minimal x402 client. Exports one function:

```typescript
export interface X402PurchaseResult {
  txHash: string;
  paymentId: string;
  creditedCents: number;
  targetType?: string;
  targetAddress?: string;
}

export async function purchaseCreditsX402(opts: {
  url: string;            // fully-resolved endpoint URL
  amountCents: number;
  account: PrivateKeyAccount; // viem account (signer)
  timeoutMs?: number;     // default 60s
  verbose?: boolean;
}): Promise<X402PurchaseResult>;
```

The EIP-712 `chainId` is **not** a parameter — it is derived from the CAIP-2
`network` in the 402 challenge (`eip155:<chainId>`), which is the authoritative
source. The caller never second-guesses the server's network.

Internals:

1. **Phase 1 — challenge.** `fetch(url, { method: "POST", headers: {Content-Type:
   application/json}, body: JSON.stringify({ amountCents }) })`. Expect `402`;
   parse the `PaymentRequired` body and pick `accepts[0]` (assert
   `scheme === "exact"` and an `eip155:*` network). Extract `amount`, `asset`,
   `payTo`, `maxTimeoutSeconds`, `extra.paymentId`, and the CAIP-2 chain id.
   - Any non-402 here is surfaced as an error using the status taxonomy above
     (e.g. `400` below-minimum, `404` unknown app/creator).
2. **Build authorization.** Construct the EIP-3009 `TransferWithAuthorization`
   typed-data:
   - `from` = `account.address`, `to` = `payTo`, `value` = `amount`,
     `validAfter` = 0, `validBefore` = now + `maxTimeoutSeconds`,
     `nonce` = random 32 bytes.
   - EIP-712 domain: USDC name/version, `chainId` from the CAIP-2 network,
     `verifyingContract` = `asset`. (USDC domain is `{ name: "USD Coin",
     version: "2", chainId, verifyingContract }` — confirmed against the asset
     during verification; overridable if the on-chain `name()`/`version()`
     differ.)
   - `signature = await account.signTypedData(...)`.
3. **Build `PaymentPayload`** (x402Version 2, `exact` scheme), embedding the
   signed authorization and `accepted.extra.paymentId`. Base64-encode the JSON.
4. **Phase 2 — settle.** Re-`POST` the same body with `X-PAYMENT: <base64>`.
   Expect `201`; parse the JSON body for `txHash`/`creditedCents`/`paymentId`
   and (defensively) decode `X-PAYMENT-RESPONSE` for the receipt `transaction`
   if the body lacks `txHash`. Map non-201 via the taxonomy.

Exact byte-level shapes (`PaymentPayload`, EIP-3009 typed-data) are pinned in the
implementation against the foundation Go structs (`x402.PaymentPayload`,
`x402.PaymentRequirements`) and adjusted during end-to-end verification.

### Modified: `packages/cli/src/commands/billing/top-up.ts`

#### Flags

```
--method   usdc | card | x402   (optional; prompts if omitted)
--creator  <address>            (x402 only; target a creator's pool)
--app      <address>            (x402 only; target an app's billing)
--api-url  <url>                (x402 only; override platform API base URL)
```

`--creator` and `--app` are **mutually exclusive**; passing both is an error.

#### Method selection

Add `x402` to `--method` options and to the interactive picker:
```
Credit card
USDC (on-chain)
USDC (x402)
```

#### New `handleX402()` method

1. **Resolve target** (the path segment + address):
   - `--app <addr>`  → `POST /apps/{addr}/x402-credits`, `targetType = app`.
   - `--creator <addr>` → `POST /creators/{addr}/x402-credits`.
   - neither → default to **your own creator address** = `billing.address`
     (your wallet) → `POST /creators/{billing.address}/x402-credits`.
   This gives x402 the same "tops up *me* by default" behavior as card/USDC,
   with explicit overrides.
2. **Resolve base URL** (order): `--api-url` flag → `ECLOUD_API_URL` env →
   `environmentConfig.platformApiURL` (new SDK field, below). If none resolves,
   error: `no platform API URL configured for environment "<env>"; pass
   --api-url`.
3. **Resolve amount** (interactive, TS-consistent): if `--amount` absent, prompt
   for whole dollars (min $5, integer-only — same validator as the card path).
   `amountCents = dollars * 100`. Enforce the $5 minimum client-side to fail
   before any signing.
4. **Resolve signer.** Resolve the private key via the same
   `requirePrivateKey({ privateKey: flags["private-key"] })` the billing client
   already uses, then build the viem signer with `privateKeyToAccount(key as
   Hex)` — the established CLI pattern (`utils/viemClients.ts`,
   `compute/app/list.ts`). `billing.address` (from `createBillingClient`) is the
   default creator target and matches this account's address.
5. **Call** `purchaseCreditsX402({ url, amountCents, account, verbose })`.
6. **Output + poll.** Print `✓ x402 payment settled`, the `txHash`, `paymentId`,
   and credited amount; then reuse the existing `pollForCredits()` loop to
   confirm the balance moved (best-effort, same 3-minute window as the other
   methods). Note: when crediting a different app/creator than your own
   developer account, the poll watches *your* balance and may not observe the
   change — in that case the poll's existing timeout message is acceptable, and
   the `201` + `txHash` is the source of truth. The poll is skipped when the
   target is not the caller's own address.

#### Description & examples

Update `static description` and `static examples`:
```
<%= config.bin %> billing top-up --method x402 --amount 50
<%= config.bin %> billing top-up --method x402 --amount 50 --app 0xApp...
<%= config.bin %> billing top-up --method x402 --amount 50 --creator 0xCreator...
```

### Modified: `packages/sdk/src/client/common/config/environment.ts` (+ types)

Add an optional `platformApiURL` to `EnvironmentConfig` (the ecloud-platform
HTTP host that serves the x402 endpoint — distinct from `userApiServerURL` and
`billingApiServerURL`), mirroring the Go PR's per-environment `APIBaseURL`.

- `EnvironmentConfig` (in `types/index.ts`): add `platformApiURL?: string`.
- `ENVIRONMENTS["sepolia-dev"]`: set `platformApiURL` to the dev platform host
  (the value used by the Go PR's `sepolia-dev.APIBaseURL`; confirmed during
  verification). Other environments left unset until the endpoint is deployed
  there — `--api-url`/`ECLOUD_API_URL` cover those in the meantime.
- `getEnvironmentConfig` already spreads `...env`; honor the existing
  `ECLOUD_API_URL` override only for `userApiServerURL` (unchanged). The x402
  base-URL resolution lives in the CLI, reading `platformApiURL` from the
  returned config plus its own `--api-url`/env fallbacks, so SDK behavior for
  other surfaces is untouched.

This is the one SDK touch — it's config data, not billing logic, so it doesn't
violate the "x402 logic is CLI-only" decision.

### Dependencies

No new runtime dependencies. `viem` (signing, types) is already a CLI + SDK
dependency; `fetch` is built into Node 18 (the CLI's `target`). The hand-rolled
client deliberately avoids `x402`/`@x402/*`.

### Tests

File: `packages/cli/src/commands/billing/__tests__/top-up.test.ts` (extend the
existing suite; mirror its mocking style).

Mock the new `purchaseCreditsX402` (via `vi.mock("../../../x402/client")`) on the
command path, plus a unit test of the client itself with a mocked `fetch`.

Command-level cases:
- **x402 default target:** no `--creator`/`--app` → URL is
  `/creators/{wallet}/x402-credits`.
- **`--app` target:** URL is `/apps/{app}/x402-credits`.
- **`--creator` target:** URL is `/creators/{creator}/x402-credits`.
- **`--app` + `--creator` together:** errors (mutually exclusive).
- **amount below $5:** validation error, no client call.
- **`--method x402 --amount 50`:** skips prompts.
- **base-URL resolution:** `--api-url` wins; missing config + no flag → clear
  error.
- **happy path (201):** `purchaseCreditsX402` resolves
  `{ txHash, paymentId, creditedCents }` → output contains txHash + credited
  amount; poll runs only for self-target.

Client-unit cases (mocked `fetch`):
- **402 → sign → 201:** asserts phase-2 request carries `X-PAYMENT`, the body
  echoes `paymentId`, and the result parses `txHash`/`creditedCents`.
- **non-402 phase-1 / non-201 phase-2:** map to taxonomy errors.

## Files changed

| File | Change |
|------|--------|
| `packages/cli/src/x402/client.ts` | New minimal viem-based x402 client (`purchaseCreditsX402`) |
| `packages/cli/src/commands/billing/top-up.ts` | Add `x402` method, `--creator`/`--app`/`--api-url` flags, `handleX402()`, picker entry, examples |
| `packages/sdk/src/client/common/types/index.ts` | Add `platformApiURL?` to `EnvironmentConfig` |
| `packages/sdk/src/client/common/config/environment.ts` | Set `platformApiURL` for `sepolia-dev` |
| `packages/cli/src/commands/billing/__tests__/top-up.test.ts` | x402 command cases |
| `packages/cli/src/x402/__tests__/client.test.ts` | New client unit tests (mocked fetch) |

## Verification (end-to-end, at the end)

Because no published TS client guarantees wire compatibility with the foundation
Go server, validate against the live `sepolia-dev` endpoint before considering
the work done:

1. Fund a test wallet with Base Sepolia USDC.
2. Run `ec billing top-up --method x402 --amount 5 --app <test-app>
   --environment sepolia-dev` (or `--api-url`).
3. Confirm a `201` with a real `txHash`, and that the pending purchase settles.
4. If the payload is rejected, the EIP-3009 typed-data / `PaymentPayload` shape
   in `x402/client.ts` is the only thing to adjust.

## Out of scope

- Adding x402 to the SDK's public surface (kept CLI-only for now).
- The `/.well-known/x402.json` discovery document (server-side; not needed for a
  client that already knows the route).
- Non-Base / non-EVM x402 networks (server is Base-only).
- Browser/agent x402 purchasing (this is the CLI path).
- A `platformApiURL` for `sepolia`/`mainnet-alpha` (added when the endpoint
  deploys there; `--api-url`/`ECLOUD_API_URL` cover them meanwhile).
