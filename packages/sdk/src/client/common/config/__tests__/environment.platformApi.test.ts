import { describe, it, expect } from "vitest";
import { getEnvironmentConfig } from "../environment";

describe("EnvironmentConfig.platformApiURL", () => {
  it("sepolia-dev has a platform API URL", () => {
    const cfg = getEnvironmentConfig("sepolia-dev");
    expect(cfg.platformApiURL).toBe(
      "https://ecloud-platform-dev.internal.eigencompute-testnet.eigenlabshq.net",
    );
  });
});
