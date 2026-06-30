/**
 * x402 protocol wire types (v2 payload over the X-PAYMENT header) and the
 * per-network USDC EIP-712 domain table.
 *
 * Pinned to the foundation server contract (github.com/x402-foundation/x402/go
 * @ 45d81d46): the ecloud-platform handler reads the `X-PAYMENT` header but
 * emits an x402Version:2 / CAIP-2 challenge, so the payload below is v2-shaped
 * even though the header name is the v1 `X-PAYMENT`.
 */

/** A single accepted payment requirement from a 402 challenge. */
export interface PaymentRequirements {
  scheme: string;
  network: string; // CAIP-2, e.g. "eip155:84532"
  asset: string; // USDC contract address
  amount: string; // atomic units (USDC has 6 decimals), as a decimal string
  payTo: string;
  maxTimeoutSeconds: number;
  /** Carries `paymentId`, and optionally token `name`/`version`. */
  extra?: Record<string, unknown>;
}

/** The body of a 402 Payment Required response. */
export interface PaymentRequired {
  x402Version: number;
  accepts: PaymentRequirements[];
  error?: string;
  extensions?: Record<string, unknown>;
}

/** EIP-3009 TransferWithAuthorization fields (all strings on the wire). */
export interface Eip3009Authorization {
  from: string;
  to: string;
  value: string; // decimal string
  validAfter: string; // unix seconds, decimal string
  validBefore: string; // unix seconds, decimal string
  nonce: string; // 0x-prefixed 32-byte hex
}

/** The v2 payment payload base64'd into the X-PAYMENT header. */
export interface PaymentPayload {
  x402Version: number;
  payload: {
    signature: string; // 0x-prefixed 65-byte hex
    authorization: Eip3009Authorization;
  };
  /** The chosen requirement, echoed verbatim (carries extra.paymentId). */
  accepted: PaymentRequirements;
}

/** Parsed result of a successful settlement (HTTP 201 body). */
export interface X402PurchaseResult {
  txHash: string;
  paymentId: string;
  creditedCents: number;
  targetType?: string;
  targetAddress?: string;
}

export interface UsdcDomainInfo {
  name: string;
  version: string;
}

/**
 * USDC EIP-712 domain (name/version) per CAIP-2 network. Values pinned from the
 * x402 foundation NetworkConfigs table. Base Sepolia USDC is "USDC"; Base
 * mainnet USDC is "USD Coin" — they differ, so the table is required.
 */
export const USDC_DOMAINS: Record<string, UsdcDomainInfo> = {
  "eip155:84532": { name: "USDC", version: "2" }, // Base Sepolia
  "eip155:8453": { name: "USD Coin", version: "2" }, // Base mainnet
};

/**
 * Resolve the USDC EIP-712 domain name/version for a network. A challenge's
 * `extra.name`/`extra.version` win when present (server is authoritative);
 * otherwise fall back to the per-network table. Throws if neither resolves.
 */
export function usdcDomainForNetwork(
  network: string,
  extra?: Record<string, unknown>,
): UsdcDomainInfo {
  const extraName = typeof extra?.name === "string" ? (extra.name as string) : undefined;
  const extraVersion = typeof extra?.version === "string" ? (extra.version as string) : undefined;
  if (extraName && extraVersion) {
    return { name: extraName, version: extraVersion };
  }
  const fromTable = USDC_DOMAINS[network];
  if (fromTable) {
    return { name: extraName ?? fromTable.name, version: extraVersion ?? fromTable.version };
  }
  throw new Error(
    `Cannot determine USDC EIP-712 domain for unknown x402 network "${network}"; ` +
      `the challenge must supply extra.name and extra.version.`,
  );
}
