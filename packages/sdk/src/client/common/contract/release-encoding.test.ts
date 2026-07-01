import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionData, type Hex } from "viem";
import AppControllerABIv1_5 from "../abis/AppController.json";
import AppControllerABIv1_4 from "../abis/AppController.v1_4.json";
import { EMPTY_CONTAINER_POLICY, type ContainerPolicy } from "../types";

/**
 * Regression guard for the per-environment AppController `Release` ABI.
 *
 * v1.5.x (sepolia-dev) added a 4th field `containerPolicy` to the on-chain
 * `Release` struct (eigenx-contracts KMS-006), changing the `createApp`
 * selector from 0xa60daa8f to 0x5e92a19f. v1.4.x (sepolia, mainnet-alpha) is
 * still on the 3-field struct. The SDK ships both ABIs and selects per
 * environment, so both shapes must keep encoding to their respective selectors.
 */
describe("AppController Release encoding (per-version)", () => {
  const SALT = `0x${"22".repeat(32)}` as Hex;
  const APP = `0x${"33".repeat(20)}` as Hex;
  const rmsRelease = {
    artifacts: [{ digest: `0x${"11".repeat(32)}` as Hex, registry: "docker.io/acme/app" }],
    upgradeByTime: 4_000_000_000,
  };
  const release3 = { rmsRelease, publicEnv: "0x" as Hex, encryptedEnv: "0x" as Hex };
  const release4 = { ...release3, containerPolicy: EMPTY_CONTAINER_POLICY };

  describe("v1.5 (4-field, sepolia-dev)", () => {
    it("encodes createApp with the v1.5 selector", () => {
      const data = encodeFunctionData({
        abi: AppControllerABIv1_5,
        functionName: "createApp",
        args: [SALT, release4],
      });
      expect(data.slice(0, 10)).toBe("0x5e92a19f");
    });

    it("encodes createAppWithIsolatedBilling and upgradeApp without throwing", () => {
      expect(() =>
        encodeFunctionData({
          abi: AppControllerABIv1_5,
          functionName: "createAppWithIsolatedBilling",
          args: [SALT, release4],
        }),
      ).not.toThrow();
      expect(() =>
        encodeFunctionData({
          abi: AppControllerABIv1_5,
          functionName: "upgradeApp",
          args: [APP, release4],
        }),
      ).not.toThrow();
    });

    it("round-trips the containerPolicy field", () => {
      const policy: ContainerPolicy = {
        args: ["--flag"],
        cmdOverride: ["/bin/run"],
        env: [{ key: "FOO", value: "bar" }],
        envOverride: [],
        restartPolicy: "always",
      };
      const data = encodeFunctionData({
        abi: AppControllerABIv1_5,
        functionName: "createApp",
        args: [SALT, { ...release3, containerPolicy: policy }],
      });
      const { args } = decodeFunctionData({ abi: AppControllerABIv1_5, data });
      const release = args![1] as { containerPolicy: ContainerPolicy };
      expect(release.containerPolicy).toEqual(policy);
    });

    it("rejects the 3-field shape (arity guard)", () => {
      expect(() =>
        encodeFunctionData({
          abi: AppControllerABIv1_5,
          functionName: "createApp",
          args: [SALT, release3],
        }),
      ).toThrow();
    });
  });

  describe("v1.4 (3-field, sepolia / mainnet-alpha)", () => {
    it("encodes createApp with the legacy selector", () => {
      const data = encodeFunctionData({
        abi: AppControllerABIv1_4,
        functionName: "createApp",
        args: [SALT, release3],
      });
      expect(data.slice(0, 10)).toBe("0xa60daa8f");
    });

    it("encodes createAppWithIsolatedBilling and upgradeApp without throwing", () => {
      expect(() =>
        encodeFunctionData({
          abi: AppControllerABIv1_4,
          functionName: "createAppWithIsolatedBilling",
          args: [SALT, release3],
        }),
      ).not.toThrow();
      expect(() =>
        encodeFunctionData({
          abi: AppControllerABIv1_4,
          functionName: "upgradeApp",
          args: [APP, release3],
        }),
      ).not.toThrow();
    });
  });
});
