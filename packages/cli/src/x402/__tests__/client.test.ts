import { describe, it, expect } from "vitest";
import { parseChallenge, chainIdFromNetwork, X402Error } from "../client";
import type { PaymentRequired } from "../types";

const REQS = {
  scheme: "exact",
  network: "eip155:84532",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  amount: "5000000",
  payTo: "0x000000000000000000000000000000000000dEaD",
  maxTimeoutSeconds: 60,
  extra: { paymentId: "pay_abc" },
};

describe("chainIdFromNetwork", () => {
  it("parses an eip155 CAIP-2 network", () => {
    expect(chainIdFromNetwork("eip155:84532")).toBe(84532);
  });
  it("throws for a non-eip155 network", () => {
    expect(() => chainIdFromNetwork("solana:xyz")).toThrow(/eip155/);
  });
});

describe("parseChallenge", () => {
  it("returns accepts[0] for a valid exact/eip155 challenge", () => {
    const body: PaymentRequired = { x402Version: 2, accepts: [REQS] };
    expect(parseChallenge(body)).toEqual(REQS);
  });
  it("throws when accepts is empty", () => {
    expect(() => parseChallenge({ x402Version: 2, accepts: [] })).toThrow(X402Error);
  });
  it("throws when scheme is not exact", () => {
    const body: PaymentRequired = { x402Version: 2, accepts: [{ ...REQS, scheme: "upto" }] };
    expect(() => parseChallenge(body)).toThrow(/scheme/);
  });
  it("throws when network is not eip155", () => {
    const body: PaymentRequired = { x402Version: 2, accepts: [{ ...REQS, network: "solana:x" }] };
    expect(() => parseChallenge(body)).toThrow(/eip155/);
  });
  it("throws when paymentId is missing from extra", () => {
    const body: PaymentRequired = { x402Version: 2, accepts: [{ ...REQS, extra: {} }] };
    expect(() => parseChallenge(body)).toThrow(/paymentId/);
  });
});
