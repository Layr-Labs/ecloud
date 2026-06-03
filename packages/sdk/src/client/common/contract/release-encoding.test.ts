import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionData, type Hex } from "viem";
import AppControllerABI from "../abis/AppController.json";
import { EMPTY_CONTAINER_POLICY, type ContainerPolicy } from "../types";

/**
 * Regression guard for the AppController v1.5.x `Release` ABI.
 *
 * v1.5.0 (eigenx-contracts KMS-006) added a 4th field `containerPolicy` to the
 * on-chain `Release` struct, which changed the `createApp` selector from
 * 0xa60daa8f to 0x5e92a19f. The SDK had shipped the 3-field ABI, so every
 * deploy/upgrade encoded the old selector and reverted with empty data against
 * the upgraded contract. These tests pin the new selectors and the 4-field
 * encoding so the drift cannot silently return.
 */
describe("AppController Release encoding (v1.5.x containerPolicy)", () => {
  const sampleRelease = (containerPolicy?: ContainerPolicy) => ({
    rmsRelease: {
      artifacts: [{ digest: `0x${"11".repeat(32)}` as Hex, registry: "docker.io/acme/app" }],
      upgradeByTime: 4_000_000_000,
    },
    publicEnv: "0x" as Hex,
    encryptedEnv: "0x" as Hex,
    containerPolicy: containerPolicy ?? EMPTY_CONTAINER_POLICY,
  });

  const SALT = `0x${"22".repeat(32)}` as Hex;
  const APP = `0x${"33".repeat(20)}` as Hex;

  it("encodes createApp with the v1.5.x selector (4-field Release)", () => {
    const data = encodeFunctionData({
      abi: AppControllerABI,
      functionName: "createApp",
      args: [SALT, sampleRelease()],
    });
    expect(data.slice(0, 10)).toBe("0x5e92a19f");
  });

  it("encodes createAppWithIsolatedBilling and upgradeApp without throwing", () => {
    expect(() =>
      encodeFunctionData({
        abi: AppControllerABI,
        functionName: "createAppWithIsolatedBilling",
        args: [SALT, sampleRelease()],
      }),
    ).not.toThrow();
    expect(() =>
      encodeFunctionData({
        abi: AppControllerABI,
        functionName: "upgradeApp",
        args: [APP, sampleRelease()],
      }),
    ).not.toThrow();
  });

  it("round-trips the containerPolicy field through the ABI", () => {
    const policy: ContainerPolicy = {
      args: ["--flag"],
      cmdOverride: ["/bin/run"],
      env: [{ key: "FOO", value: "bar" }],
      envOverride: [],
      restartPolicy: "always",
    };
    const data = encodeFunctionData({
      abi: AppControllerABI,
      functionName: "createApp",
      args: [SALT, sampleRelease(policy)],
    });
    const { args } = decodeFunctionData({ abi: AppControllerABI, data });
    // args = [salt, release]; release.containerPolicy is the 4th tuple field
    const release = args![1] as { containerPolicy: ContainerPolicy };
    expect(release.containerPolicy).toEqual(policy);
  });

  it("keeps the old 3-field selector out of the ABI (drift guard)", () => {
    expect(() =>
      // The pre-v1.5.0 3-field Release shape must no longer encode against this ABI.
      encodeFunctionData({
        abi: AppControllerABI,
        functionName: "createApp",
        args: [
          SALT,
          {
            rmsRelease: { artifacts: [], upgradeByTime: 0 },
            publicEnv: "0x" as Hex,
            encryptedEnv: "0x" as Hex,
            // containerPolicy intentionally omitted -> viem must reject the arity
          },
        ],
      }),
    ).toThrow();
  });
});
