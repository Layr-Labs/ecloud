import { describe, it, expect } from "vitest";
import { ConflictError } from "@layr-labs/ecloud-sdk";

describe("ConflictError", () => {
  it("is an instance of Error", () => {
    const err = new ConflictError();
    expect(err).toBeInstanceOf(Error);
  });

  it("has name 'ConflictError'", () => {
    const err = new ConflictError();
    expect(err.name).toBe("ConflictError");
  });

  it("uses default message when none provided", () => {
    const err = new ConflictError();
    expect(err.message).toBe("Build already in progress");
  });

  it("accepts a custom message", () => {
    const err = new ConflictError("custom conflict message");
    expect(err.message).toBe("custom conflict message");
  });

  it("can be caught with instanceof check", () => {
    const err = new ConflictError();
    let caught = false;

    try {
      throw err;
    } catch (e) {
      if (e instanceof ConflictError) {
        caught = true;
      }
    }

    expect(caught).toBe(true);
  });

  it("is not caught by generic Error name checks for other error types", () => {
    const err = new ConflictError();
    expect(err.name).not.toBe("BuildFailedError");
    expect(err.name).not.toBe("AuthRequiredError");
  });
});
