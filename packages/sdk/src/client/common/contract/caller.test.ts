import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PublicClient } from "viem";
import type { EnvironmentConfig } from "../types";

// ---- constants used across tests ----

const APP_ID = "0x000000000000000000000000000000000000aaaa" as `0x${string}`;
const CONTROLLER = "0x000000000000000000000000000000000000cccc";

const READY_AT = 1_700_000_000n;
const RELEASE_HASH = "0x" + "ab".repeat(32) as `0x${string}`;

const MOCK_DIGEST = ("0x" + "ab".repeat(32)) as `0x${string}`;
const MOCK_PUBLIC_ENV = ("0x" + "cd".repeat(8)) as `0x${string}`;
const MOCK_ENCRYPTED_ENV = ("0x" + "ef".repeat(16)) as `0x${string}`;
const MOCK_REGISTRY = "registry.example.com/app:abc123";
const MOCK_UPGRADE_BY_TIME = 9_999_999;

const ENV_CONFIG = {
  appControllerAddress: CONTROLLER,
} as unknown as EnvironmentConfig;

function makeMockLog(readyAt = READY_AT) {
  return {
    args: {
      app: APP_ID,
      readyAt,
      release: {
        rmsRelease: {
          artifacts: [{ digest: MOCK_DIGEST, registry: MOCK_REGISTRY }],
          upgradeByTime: MOCK_UPGRADE_BY_TIME,
        },
        publicEnv: MOCK_PUBLIC_ENV,
        encryptedEnv: MOCK_ENCRYPTED_ENV,
      },
    },
  };
}

function makePublicClient({
  readyAt = READY_AT,
  logs = [makeMockLog()],
}: {
  readyAt?: bigint;
  logs?: ReturnType<typeof makeMockLog>[];
} = {}): PublicClient {
  return {
    readContract: vi.fn().mockResolvedValue({ releaseHash: RELEASE_HASH, readyAt }),
    getLogs: vi.fn().mockResolvedValue(logs),
  } as unknown as PublicClient;
}

// Lazy import so mocks are set up before the module loads
let getScheduledRelease: typeof import("./caller").getScheduledRelease;

beforeEach(async () => {
  ({ getScheduledRelease } = await import("./caller"));
});

// ---- tests ----

describe("getScheduledRelease", () => {
  it("returns a correctly typed Release matching the pending readyAt", async () => {
    const client = makePublicClient();

    const release = await getScheduledRelease(client, ENV_CONFIG, APP_ID);

    expect(release.rmsRelease.artifacts).toHaveLength(1);
    expect(release.rmsRelease.artifacts[0].registry).toBe(MOCK_REGISTRY);
    expect(release.rmsRelease.upgradeByTime).toBe(MOCK_UPGRADE_BY_TIME);

    // digest: bytes32 hex → 32-byte Uint8Array
    expect(release.rmsRelease.artifacts[0].digest).toBeInstanceOf(Uint8Array);
    expect(release.rmsRelease.artifacts[0].digest).toHaveLength(32);

    // publicEnv / encryptedEnv: bytes hex → Uint8Array
    expect(release.publicEnv).toBeInstanceOf(Uint8Array);
    expect(release.publicEnv).toHaveLength(8);
    expect(release.encryptedEnv).toBeInstanceOf(Uint8Array);
    expect(release.encryptedEnv).toHaveLength(16);
  });

  it("throws when no upgrade is pending (readyAt === 0n)", async () => {
    const client = makePublicClient({ readyAt: 0n });

    await expect(getScheduledRelease(client, ENV_CONFIG, APP_ID)).rejects.toThrow(
      "no upgrade is scheduled for this app",
    );
    expect(client.getLogs).not.toHaveBeenCalled();
  });

  it("throws when logs contain no event matching the pending readyAt", async () => {
    const client = makePublicClient({ logs: [makeMockLog(READY_AT + 1n)] });

    await expect(getScheduledRelease(client, ENV_CONFIG, APP_ID)).rejects.toThrow(
      "AppUpgradeScheduled event not found",
    );
  });

  it("throws when logs are empty", async () => {
    const client = makePublicClient({ logs: [] });

    await expect(getScheduledRelease(client, ENV_CONFIG, APP_ID)).rejects.toThrow(
      "AppUpgradeScheduled event not found",
    );
  });

  it("returns the most recent matching event when multiple logs exist", async () => {
    const OLD_REGISTRY = "registry.example.com/app:old";
    const NEW_REGISTRY = "registry.example.com/app:new";

    const olderLog = {
      ...makeMockLog(READY_AT),
      args: {
        ...makeMockLog(READY_AT).args,
        release: {
          ...makeMockLog(READY_AT).args.release,
          rmsRelease: {
            artifacts: [{ digest: MOCK_DIGEST, registry: OLD_REGISTRY }],
            upgradeByTime: MOCK_UPGRADE_BY_TIME,
          },
        },
      },
    };
    const newerLog = {
      ...makeMockLog(READY_AT),
      args: {
        ...makeMockLog(READY_AT).args,
        release: {
          ...makeMockLog(READY_AT).args.release,
          rmsRelease: {
            artifacts: [{ digest: MOCK_DIGEST, registry: NEW_REGISTRY }],
            upgradeByTime: MOCK_UPGRADE_BY_TIME,
          },
        },
      },
    };

    // getLogs returns chronological order; getScheduledRelease searches newest-first
    const client = makePublicClient({ logs: [olderLog, newerLog] });

    const release = await getScheduledRelease(client, ENV_CONFIG, APP_ID);
    expect(release.rmsRelease.artifacts[0].registry).toBe(NEW_REGISTRY);
  });

  it("queries getLogs filtered to the app controller address and app", async () => {
    const client = makePublicClient();

    await getScheduledRelease(client, ENV_CONFIG, APP_ID);

    expect(client.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        address: CONTROLLER,
        args: expect.objectContaining({ app: APP_ID }),
        fromBlock: "earliest",
      }),
    );
  });
});
