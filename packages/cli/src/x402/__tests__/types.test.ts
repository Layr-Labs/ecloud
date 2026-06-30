import { describe, it, expect } from "vitest";
import { usdcDomainForNetwork, USDC_DOMAINS } from "../types";

describe("usdcDomainForNetwork", () => {
  it("returns Base Sepolia USDC domain by default", () => {
    expect(usdcDomainForNetwork("eip155:84532")).toEqual({ name: "USDC", version: "2" });
  });

  it("returns Base mainnet USDC domain", () => {
    expect(usdcDomainForNetwork("eip155:8453")).toEqual({ name: "USD Coin", version: "2" });
  });

  it("prefers name/version from the challenge extra over the table", () => {
    expect(
      usdcDomainForNetwork("eip155:84532", { name: "Custom", version: "7" }),
    ).toEqual({ name: "Custom", version: "7" });
  });

  it("throws for an unknown network with no extra override", () => {
    expect(() => usdcDomainForNetwork("eip155:99999")).toThrow(/unknown.*network/i);
  });

  it("has Base Sepolia and Base mainnet in the table", () => {
    expect(Object.keys(USDC_DOMAINS)).toEqual(
      expect.arrayContaining(["eip155:84532", "eip155:8453"]),
    );
  });
});
