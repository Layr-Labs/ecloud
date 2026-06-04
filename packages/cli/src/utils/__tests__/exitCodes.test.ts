import { describe, expect, it } from "vitest";
import { EXIT_CODES, errorMessage, stageFailure } from "../exitCodes";

describe("errorMessage", () => {
  it("extracts Error.message", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("stringifies non-Error values", () => {
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorMessage(42)).toBe("42");
  });
});

describe("stageFailure — maps a failed deploy/upgrade stage to message + exit code", () => {
  it("invalid-input maps to exit 2 before any build", () => {
    const { exit } = stageFailure("deploy", "invalid-input", "two flags missing");
    expect(exit).toBe(EXIT_CODES.INVALID_INPUT);
  });

  it("build-stage failure maps to exit 3 and says no on-chain tx was attempted", () => {
    const { message, exit } = stageFailure("deploy", "build", new Error("docker push 500"));
    expect(exit).toBe(EXIT_CODES.BUILD_FAILED);
    expect(message).toContain("Build/push failed");
    expect(message).toContain("no deployment was attempted");
    expect(message).toContain("docker push 500");
  });

  it("on-chain-stage failure maps to exit 4 and notes the image is already pushed", () => {
    const { message, exit } = stageFailure("deploy", "onchain", new Error("nonce too low"));
    expect(exit).toBe(EXIT_CODES.ONCHAIN_FAILED);
    expect(message).toContain("On-chain deployment failed");
    expect(message).toContain("nonce too low");
    expect(message).toContain("re-running deploy will reuse it");
  });

  it("uses operation-specific wording for upgrade", () => {
    const build = stageFailure("upgrade", "build", new Error("x"));
    expect(build.message).toContain("no upgrade was attempted");

    const onchain = stageFailure("upgrade", "onchain", new Error("x"));
    expect(onchain.message).toContain("On-chain upgrade failed");
    expect(onchain.message).toContain("re-running upgrade will reuse it");
  });

  it("each stage carries a distinct exit code", () => {
    const exits = (["invalid-input", "build", "onchain"] as const).map(
      (s) => stageFailure("deploy", s, "e").exit,
    );
    expect(new Set(exits).size).toBe(3);
  });
});
