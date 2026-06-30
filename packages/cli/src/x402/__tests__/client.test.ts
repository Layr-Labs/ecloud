import { describe, it, expect } from "vitest";
import { parseChallenge, chainIdFromNetwork, X402Error, buildSignedPayload, encodePaymentHeader, purchaseCreditsX402 } from "../client";
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

const FIXED_NONCE = "0x" + "11".repeat(32);
const NOW = 1_900_000_000;

function fakeAccount() {
  const calls: any[] = [];
  return {
    address: "0xPayerAddress00000000000000000000000000aa",
    calls,
    signTypedData: async (args: any) => {
      calls.push(args);
      return "0x" + "ab".repeat(65);
    },
  };
}

describe("buildSignedPayload", () => {
  it("signs EIP-3009 over the requirement and assembles a v2 payload", async () => {
    const reqs = {
      scheme: "exact",
      network: "eip155:84532",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      amount: "5000000",
      payTo: "0x000000000000000000000000000000000000dEaD",
      maxTimeoutSeconds: 60,
      extra: { paymentId: "pay_abc" },
    };
    const account = fakeAccount();

    const payload = await buildSignedPayload(reqs, account, NOW, () => FIXED_NONCE);

    // v2 envelope
    expect(payload.x402Version).toBe(2);
    expect(payload.accepted).toEqual(reqs); // echoed verbatim (carries paymentId)
    expect(payload.payload.signature).toBe("0x" + "ab".repeat(65));

    // authorization fields are STRINGS, amount signed verbatim
    expect(payload.payload.authorization).toEqual({
      from: account.address,
      to: reqs.payTo,
      value: "5000000",
      validAfter: String(NOW - 600),
      validBefore: String(NOW + 3600),
      nonce: FIXED_NONCE,
    });

    // signTypedData called with correct domain + types + bigint message values
    const arg = account.calls[0];
    expect(arg.primaryType).toBe("TransferWithAuthorization");
    expect(arg.domain).toEqual({
      name: "USDC",
      version: "2",
      chainId: 84532,
      verifyingContract: reqs.asset,
    });
    expect(arg.types.TransferWithAuthorization).toEqual([
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ]);
    expect(arg.message.value).toBe(5_000_000n);
    expect(arg.message.validAfter).toBe(BigInt(NOW - 600));
    expect(arg.message.validBefore).toBe(BigInt(NOW + 3600));
    expect(arg.message.nonce).toBe(FIXED_NONCE);
    // EIP712Domain is NOT in the types map (viem derives it)
    expect(arg.types.EIP712Domain).toBeUndefined();
  });
});

describe("encodePaymentHeader", () => {
  it("base64-encodes the JSON payload round-trippably", () => {
    const payload = { x402Version: 2, payload: { signature: "0x", authorization: {} }, accepted: {} } as any;
    const header = encodePaymentHeader(payload);
    expect(JSON.parse(Buffer.from(header, "base64").toString("utf8"))).toEqual(payload);
  });
});

const REQS_BODY = {
  x402Version: 2,
  accepts: [
    {
      scheme: "exact",
      network: "eip155:84532",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      amount: "5000000",
      payTo: "0x000000000000000000000000000000000000dEaD",
      maxTimeoutSeconds: 60,
      extra: { paymentId: "pay_abc" },
    },
  ],
};

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("purchaseCreditsX402", () => {
  it("402 → sign → 201: returns parsed result and sends X-PAYMENT on retry", async () => {
    const account = fakeAccount();
    const seen: Array<{ headers: Headers; body: string }> = [];
    const fetchImpl = (async (_url: string, init: any) => {
      seen.push({ headers: new Headers(init.headers), body: init.body });
      if (seen.length === 1) return jsonResponse(402, REQS_BODY);
      return jsonResponse(201, {
        targetType: "creator",
        targetAddress: "0xCreator",
        creditedCents: 500,
        paymentId: "pay_abc",
        txHash: "0xdeadbeef",
      });
    }) as unknown as typeof fetch;

    const result = await purchaseCreditsX402({
      url: "https://host/creators/0xCreator/x402-credits",
      amountCents: 500,
      account,
      fetchImpl,
    });

    expect(result).toEqual({
      txHash: "0xdeadbeef",
      paymentId: "pay_abc",
      creditedCents: 500,
      targetType: "creator",
      targetAddress: "0xCreator",
    });
    // phase 1 has no payment header; phase 2 does
    expect(seen[0].headers.get("x-payment")).toBeNull();
    expect(seen[1].headers.get("x-payment")).toBeTruthy();
    // the signed payload echoes the paymentId
    const decoded = JSON.parse(Buffer.from(seen[1].headers.get("x-payment")!, "base64").toString());
    expect(decoded.accepted.extra.paymentId).toBe("pay_abc");
    expect(decoded.payload.authorization.value).toBe("5000000");
  });

  it("phase-1 non-402 maps to an X402Error with status", async () => {
    const fetchImpl = (async () =>
      jsonResponse(400, { error: "amountCents is below the minimum" })) as unknown as typeof fetch;
    await expect(
      purchaseCreditsX402({ url: "https://h/x", amountCents: 500, account: fakeAccount(), fetchImpl }),
    ).rejects.toThrow(/below the minimum/);
  });

  it("phase-2 502 maps to a settlement-failed error", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n += 1;
      return n === 1 ? jsonResponse(402, REQS_BODY) : jsonResponse(502, { error: "x" });
    }) as unknown as typeof fetch;
    await expect(
      purchaseCreditsX402({ url: "https://h/x", amountCents: 500, account: fakeAccount(), fetchImpl }),
    ).rejects.toThrow(/settlement failed/i);
  });

  it("falls back to X-PAYMENT-RESPONSE receipt when body lacks txHash", async () => {
    const receipt = Buffer.from(
      JSON.stringify({ success: true, transaction: "0xfromheader", paymentId: "pay_abc" }),
    ).toString("base64");
    let n = 0;
    const fetchImpl = (async () => {
      n += 1;
      if (n === 1) return jsonResponse(402, REQS_BODY);
      return jsonResponse(
        201,
        { targetType: "creator", targetAddress: "0xC", creditedCents: 500, paymentId: "pay_abc" },
        { "x-payment-response": receipt },
      );
    }) as unknown as typeof fetch;

    const result = await purchaseCreditsX402({
      url: "https://h/x",
      amountCents: 500,
      account: fakeAccount(),
      fetchImpl,
    });
    expect(result.txHash).toBe("0xfromheader");
  });
});
