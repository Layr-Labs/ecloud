import { describe, expect, it } from "vitest";
import { encodeFunctionData, type Hex } from "viem";
import AppControllerABIv1_5 from "../abis/AppController.json";
import AppControllerABIv1_4 from "../abis/AppController.v1_4.json";
import { getEnvironmentConfig } from "../config/environment";
import { EMPTY_CONTAINER_POLICY } from "../types";

// Mirror caller.ts selection logic to assert config wires the right ABI per env.
function abiFor(v?: string) {
  return v === "v1.4" ? AppControllerABIv1_4 : AppControllerABIv1_5;
}

describe("env -> AppController ABI selection", () => {
  const rms = {
    artifacts: [{ digest: `0x${"11".repeat(32)}` as Hex, registry: "r" }],
    upgradeByTime: 4_000_000_000,
  };
  const origBuild = process.env.BUILD_TYPE;
  const cases: Array<[string, string, string]> = [["sepolia-dev", "dev", "0x5e92a19f"]];
  for (const [env, build, sel] of cases) {
    it(`${env} selects selector ${sel}`, () => {
      process.env.BUILD_TYPE = build;
      const cfg = getEnvironmentConfig(env);
      const abi = abiFor(cfg.releaseAbiVersion);
      const rel =
        cfg.releaseAbiVersion === "v1.4"
          ? { rmsRelease: rms, publicEnv: "0x" as Hex, encryptedEnv: "0x" as Hex }
          : {
              rmsRelease: rms,
              publicEnv: "0x" as Hex,
              encryptedEnv: "0x" as Hex,
              containerPolicy: EMPTY_CONTAINER_POLICY,
            };
      const data = encodeFunctionData({
        abi,
        functionName: "createApp",
        args: [`0x${"22".repeat(32)}` as Hex, rel],
      });
      expect(data.slice(0, 10)).toBe(sel);
      if (origBuild === undefined) delete process.env.BUILD_TYPE;
      else process.env.BUILD_TYPE = origBuild;
    });
  }
  it("prod envs are pinned to v1.4", () => {
    process.env.BUILD_TYPE = "prod";
    expect(getEnvironmentConfig("sepolia").releaseAbiVersion).toBe("v1.4");
    expect(getEnvironmentConfig("mainnet-alpha").releaseAbiVersion).toBe("v1.4");
    if (origBuild === undefined) delete process.env.BUILD_TYPE;
    else process.env.BUILD_TYPE = origBuild;
  });
});
