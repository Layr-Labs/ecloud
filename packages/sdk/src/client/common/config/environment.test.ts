import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  derivePlatformHost,
  getBillingEnvironmentConfig,
  getEnvironmentConfig,
} from "./environment";

describe("environment config ECLOUD_API_URL override", () => {
  const originalApiUrl = process.env.ECLOUD_API_URL;
  const originalBuildType = process.env.BUILD_TYPE;

  beforeEach(() => {
    // Ensure sepolia-dev is an available environment for getEnvironmentConfig()
    process.env.BUILD_TYPE = "dev";
    delete process.env.ECLOUD_API_URL;
  });

  afterEach(() => {
    if (originalApiUrl === undefined) delete process.env.ECLOUD_API_URL;
    else process.env.ECLOUD_API_URL = originalApiUrl;
    if (originalBuildType === undefined) delete process.env.BUILD_TYPE;
    else process.env.BUILD_TYPE = originalBuildType;
  });

  it("uses built-in userApiServerURL when ECLOUD_API_URL is unset", () => {
    const cfg = getEnvironmentConfig("sepolia-dev");
    expect(cfg.userApiServerURL).toBe("https://userapi-compute-sepolia-dev.eigencloud.xyz");
  });

  it("overrides userApiServerURL when ECLOUD_API_URL is set", () => {
    process.env.ECLOUD_API_URL =
      "https://ecloud-platform-sepolia-dev.internal.eigencompute-testnet.eigenlabshq.net";
    const cfg = getEnvironmentConfig("sepolia-dev");
    expect(cfg.userApiServerURL).toBe(
      "https://ecloud-platform-sepolia-dev.internal.eigencompute-testnet.eigenlabshq.net",
    );
  });

  it("strips a single trailing slash from ECLOUD_API_URL", () => {
    process.env.ECLOUD_API_URL = "https://example.com/";
    expect(getEnvironmentConfig("sepolia-dev").userApiServerURL).toBe("https://example.com");
  });

  it("strips multiple trailing slashes from ECLOUD_API_URL", () => {
    process.env.ECLOUD_API_URL = "https://example.com///";
    expect(getEnvironmentConfig("sepolia-dev").userApiServerURL).toBe("https://example.com");
  });

  it("treats an empty ECLOUD_API_URL as unset", () => {
    process.env.ECLOUD_API_URL = "";
    expect(getEnvironmentConfig("sepolia-dev").userApiServerURL).toBe(
      "https://userapi-compute-sepolia-dev.eigencloud.xyz",
    );
  });

  it("treats a whitespace-only ECLOUD_API_URL as unset", () => {
    process.env.ECLOUD_API_URL = "   ";
    expect(getEnvironmentConfig("sepolia-dev").userApiServerURL).toBe(
      "https://userapi-compute-sepolia-dev.eigencloud.xyz",
    );
  });

  it("leaves other environment fields untouched when overriding", () => {
    process.env.ECLOUD_API_URL = "https://example.com";
    const cfg = getEnvironmentConfig("sepolia-dev");
    expect(cfg.name).toBe("sepolia");
    expect(cfg.kmsServerURL).toBe("http://10.128.0.57:8080");
    expect(cfg.defaultRPCURL).toBe("https://ethereum-sepolia-rpc.publicnode.com");
  });

  it("uses built-in billingApiServerURL when ECLOUD_API_URL is unset", () => {
    expect(getBillingEnvironmentConfig("dev").billingApiServerURL).toBe(
      "https://billingapi-dev.eigencloud.xyz",
    );
    expect(getBillingEnvironmentConfig("prod").billingApiServerURL).toBe(
      "https://billingapi.eigencloud.xyz",
    );
  });

  it("overrides billingApiServerURL when ECLOUD_API_URL is set (dev)", () => {
    process.env.ECLOUD_API_URL = "https://example.com";
    expect(getBillingEnvironmentConfig("dev").billingApiServerURL).toBe("https://example.com");
  });

  it("overrides billingApiServerURL when ECLOUD_API_URL is set (prod)", () => {
    process.env.ECLOUD_API_URL = "https://example.com";
    expect(getBillingEnvironmentConfig("prod").billingApiServerURL).toBe("https://example.com");
  });
});

describe("derivePlatformHost", () => {
  const originalBuildType = process.env.BUILD_TYPE;
  beforeEach(() => {
    process.env.BUILD_TYPE = "dev";
  });
  afterEach(() => {
    if (originalBuildType === undefined) delete process.env.BUILD_TYPE;
    else process.env.BUILD_TYPE = originalBuildType;
  });

  it("maps sepolia-dev to testnet-sepolia.eigencloud.xyz", () => {
    const cfg = getEnvironmentConfig("sepolia-dev");
    expect(derivePlatformHost(cfg, "0xABCDEF")).toBe(
      "abcdef.testnet-sepolia.eigencloud.xyz",
    );
  });

  it("lowercases and strips the 0x prefix", () => {
    const cfg = getEnvironmentConfig("sepolia-dev");
    expect(derivePlatformHost(cfg, "ABCDEF")).toBe(
      "abcdef.testnet-sepolia.eigencloud.xyz",
    );
  });

  it("returns empty when platformEnv is not set", () => {
    const cfg = { ...getEnvironmentConfig("sepolia-dev"), platformEnv: "" };
    expect(derivePlatformHost(cfg, "0xABCDEF")).toBe("");
  });
});
