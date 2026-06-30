/**
 * Minimal, RPC-free x402 client for the ecloud-platform credit-purchase
 * endpoint. Performs the two-phase x402 handshake (402 challenge → signed
 * X-PAYMENT retry) using viem for EIP-712 signing. See
 * docs/superpowers/specs/2026-06-30-top-up-x402-design.md.
 */

import type {
  PaymentRequired,
  PaymentRequirements,
  PaymentPayload,
  X402PurchaseResult,
  Eip3009Authorization,
} from "./types";
import { usdcDomainForNetwork } from "./types";

const DEFAULT_TIMEOUT_MS = 60_000;

/** Error carrying the HTTP status that produced it (when known). */
export class X402Error extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "X402Error";
    this.status = status;
  }
}

/** Parse the chain id out of a CAIP-2 eip155 network string. */
export function chainIdFromNetwork(network: string): number {
  const m = /^eip155:(\d+)$/.exec(network);
  if (!m) {
    throw new X402Error(`Unsupported x402 network "${network}" (expected eip155:<chainId>)`);
  }
  return Number(m[1]);
}

/**
 * Validate a 402 challenge body and return the single requirement we will pay.
 * Asserts the `exact` EVM scheme, an eip155 network, and a present paymentId.
 */
export function parseChallenge(body: PaymentRequired): PaymentRequirements {
  const reqs = body?.accepts?.[0];
  if (!reqs) {
    throw new X402Error("x402 challenge had no payment requirements (accepts was empty)");
  }
  if (reqs.scheme !== "exact") {
    throw new X402Error(`Unsupported x402 scheme "${reqs.scheme}" (expected "exact")`);
  }
  // Throws if the network is not eip155.
  chainIdFromNetwork(reqs.network);
  const paymentId = reqs.extra?.paymentId;
  if (typeof paymentId !== "string" || paymentId.length === 0) {
    throw new X402Error("x402 challenge requirements missing extra.paymentId");
  }
  return reqs;
}

/** EIP-712 type definition for EIP-3009 TransferWithAuthorization. */
const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/**
 * Sign the EIP-3009 authorization for a requirement and assemble the v2
 * PaymentPayload. RPC-free: amount is signed verbatim, USDC domain comes from
 * the challenge extra or the per-network table. `nowSeconds`/`randomNonce` are
 * injected for deterministic tests.
 */
export async function buildSignedPayload(
  reqs: PaymentRequirements,
  account: { address: string; signTypedData: (args: any) => Promise<string> },
  nowSeconds: number,
  randomNonce: () => string,
): Promise<PaymentPayload> {
  const chainId = chainIdFromNetwork(reqs.network);
  const domainInfo = usdcDomainForNetwork(reqs.network, reqs.extra);

  const validAfter = nowSeconds - 600; // 10-min back-buffer for clock skew
  const validBefore = nowSeconds + 3600; // 1-hour window
  const nonce = randomNonce();

  const authorization: Eip3009Authorization = {
    from: account.address,
    to: reqs.payTo,
    value: reqs.amount, // signed verbatim — never recomputed
    validAfter: String(validAfter),
    validBefore: String(validBefore),
    nonce,
  };

  const signature = await account.signTypedData({
    domain: {
      name: domainInfo.name,
      version: domainInfo.version,
      chainId,
      verifyingContract: reqs.asset,
    },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: account.address,
      to: reqs.payTo,
      value: BigInt(reqs.amount),
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce,
    },
  });

  return {
    x402Version: 2,
    payload: { signature, authorization },
    accepted: reqs, // echoed verbatim; carries extra.paymentId
  };
}

/** base64(JSON) — the X-PAYMENT header value. */
export function encodePaymentHeader(payload: PaymentPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

// --- phase: settle (Task 4) ---

export interface PurchaseCreditsX402Opts {
  /** Fully-resolved endpoint URL (e.g. https://host/creators/0x../x402-credits). */
  url: string;
  amountCents: number;
  /** viem account: must expose address + signTypedData. */
  account: { address: string; signTypedData: (args: any) => Promise<string> };
  timeoutMs?: number;
  verbose?: boolean;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export async function purchaseCreditsX402(
  _opts: PurchaseCreditsX402Opts,
): Promise<X402PurchaseResult> {
  void DEFAULT_TIMEOUT_MS;
  throw new X402Error("not implemented");
}
