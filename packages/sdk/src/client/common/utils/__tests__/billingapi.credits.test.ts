import { describe, it, expect, vi } from "vitest";
import { BillingApiClient } from "../billingapi";

const ETH = "0x01d3e5851c5F361b4E4988fd3cCc503a6D7b5c09";

function makeClient(jsonResponse: unknown) {
  const client = new BillingApiClient(
    { billingApiServerURL: "https://billing.test" } as any,
    {} as any,
    { verbose: false } as any,
  );
  const spy = vi
    .spyOn(client as any, "makeAuthenticatedRequest")
    .mockResolvedValue({ json: async () => jsonResponse, text: async () => "" });
  return { client, spy };
}

describe("BillingApiClient.getAccountCredits", () => {
  it("calls GET /v1/accounts/{eth}/credits and maps camelCase fields", async () => {
    const { client, spy } = makeClient({
      remainingCredits: 25,
      permanentCredits: 0,
      promotionalCredits: 25,
      nextPromotionalCreditExpiry: 1751328000,
    });
    const res = await client.getAccountCredits(ETH);
    expect(spy).toHaveBeenCalledWith(
      `https://billing.test/accounts/${ETH}/credits`,
      "GET",
      "compute",
    );
    expect(res).toEqual({
      remainingCredits: 25,
      permanentCredits: 0,
      promotionalCredits: 25,
      nextPromotionalCreditExpiry: 1751328000,
    });
  });

  it("maps snake_case fields and defaults missing ones to 0", async () => {
    const { client } = makeClient({ promotional_credits: 10 });
    const res = await client.getAccountCredits(ETH);
    expect(res).toEqual({
      remainingCredits: 0,
      permanentCredits: 0,
      promotionalCredits: 10,
      nextPromotionalCreditExpiry: 0,
    });
  });

  it("coerces non-numeric/garbage values to 0", async () => {
    const { client } = makeClient({
      remainingCredits: "abc",
      permanentCredits: null,
      promotionalCredits: 15,
      nextPromotionalCreditExpiry: {},
    });
    const res = await client.getAccountCredits(ETH);
    expect(res).toEqual({
      remainingCredits: 0,
      permanentCredits: 0,
      promotionalCredits: 15,
      nextPromotionalCreditExpiry: 0,
    });
  });
});
