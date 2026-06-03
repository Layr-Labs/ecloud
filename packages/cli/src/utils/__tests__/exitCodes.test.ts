import { describe, expect, it } from "vitest";
import { EXIT_CODES, errorMessage } from "../exitCodes";

describe("deploy/upgrade exit codes (RND-591)", () => {
  it("uses distinct, stable codes per failure stage", () => {
    expect(EXIT_CODES.INVALID_INPUT).toBe(2);
    expect(EXIT_CODES.BUILD_FAILED).toBe(3);
    expect(EXIT_CODES.ONCHAIN_FAILED).toBe(4);
    // All distinct.
    expect(new Set(Object.values(EXIT_CODES)).size).toBe(3);
  });

  it("errorMessage extracts Error.message", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("errorMessage stringifies non-Error values", () => {
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorMessage(42)).toBe("42");
  });
});
