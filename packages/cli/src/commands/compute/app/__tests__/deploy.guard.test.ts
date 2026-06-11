import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Address } from "viem";

const APP_A = "0x01d3e5851c5F361b4E4988fd3cCc503a6D7b5c09" as Address;

const findLiveAppByName = vi.fn();
vi.mock("../../../../utils/appCollision", () => ({
  findLiveAppByName: (...a: unknown[]) => findLiveAppByName(...(a as [])),
}));

import { assertNoLiveNameCollision } from "../deploy";

function makeCtx() {
  const errors: { message: string; exit?: number }[] = [];
  const warns: string[] = [];
  return {
    errors,
    warns,
    cmd: {
      error: (message: string, opts?: { exit?: number }) => {
        errors.push({ message, exit: opts?.exit });
        throw new Error(message); // oclif's this.error throws
      },
      warn: (message: string) => warns.push(message),
    },
  };
}

const ARGS = { environment: "sepolia-dev", privateKey: "0xkey", rpcUrl: "https://rpc.test", name: "foo" };

describe("assertNoLiveNameCollision", () => {
  beforeEach(() => vi.clearAllMocks());

  it("errors with exit 2 and references upgrade when a live same-named app exists", async () => {
    findLiveAppByName.mockResolvedValue(APP_A);
    const { cmd, errors } = makeCtx();

    await expect(
      assertNoLiveNameCollision(cmd as any, { ...ARGS, forceNew: false }),
    ).rejects.toThrow();

    expect(errors).toHaveLength(1);
    expect(errors[0].exit).toBe(2);
    expect(errors[0].message).toContain(APP_A);
    expect(errors[0].message).toContain("upgrade");
    expect(errors[0].message).toContain("--force-new");
  });

  it("skips the check entirely when --force-new is set", async () => {
    const { cmd } = makeCtx();
    await assertNoLiveNameCollision(cmd as any, { ...ARGS, forceNew: true });
    expect(findLiveAppByName).not.toHaveBeenCalled();
  });

  it("proceeds (no error) when there is no collision", async () => {
    findLiveAppByName.mockResolvedValue(undefined);
    const { cmd, errors } = makeCtx();
    await assertNoLiveNameCollision(cmd as any, { ...ARGS, forceNew: false });
    expect(errors).toHaveLength(0);
  });

  it("fails open (warns, does not error) when the collision check throws", async () => {
    findLiveAppByName.mockRejectedValue(new Error("rpc down"));
    const { cmd, errors, warns } = makeCtx();

    await assertNoLiveNameCollision(cmd as any, { ...ARGS, forceNew: false });

    expect(errors).toHaveLength(0);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain(ARGS.name);
  });
});
