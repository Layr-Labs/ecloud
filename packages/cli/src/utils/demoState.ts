// [DEMO] Shared state for UX demo — persists logged-in identity across commands.
import { existsSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const STATE_FILE = join(tmpdir(), "ecloud-demo-state.json");

export type IdentityType = "eoa" | "safe" | "timelock";

export interface DemoIdentity {
  address: string;
  type: IdentityType;
  label: string; // e.g. "your wallet", "3/5 Safe", "Timelock, 24h delay"
  detail?: string; // e.g. "via 2/3 Safe" for timelocks
  safeAddress?: string; // for Safe / Timelock-wrapping-Safe
  delay?: string; // for timelocks
}

export interface PendingSchedule {
  appId: string;
  imageRef: string;
  readyAt: number; // unix timestamp seconds
  delayLabel: string; // human-readable delay, e.g. "2h"
}

export interface DemoApp {
  appId: string;
  name: string;
  image: string;
  status: "STARTED" | "STOPPED" | "TERMINATED";
  instanceType: string;
  ipAddress: string;
  deployedAt: number; // unix timestamp seconds
  lastUpgradeAt?: number;
  owner?: DemoIdentity; // current app owner (may differ from logged-in identity after transfer)
  timelocked?: boolean; // true if owner is a Timelock — direct upgrade is blocked
}

export interface DemoState {
  identity?: DemoIdentity;
  pendingSchedule?: PendingSchedule;
  app?: DemoApp;
}

export function getDemoState(): DemoState {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, "utf8")) as DemoState;
    }
  } catch {}
  return {};
}

export function setDemoState(state: DemoState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function clearDemoState(): void {
  try {
    if (existsSync(STATE_FILE)) {
      writeFileSync(STATE_FILE, "{}");
    }
  } catch {}
}

// Canonical demo identities used across all commands
export const DEMO_IDENTITIES: DemoIdentity[] = [
  {
    address: "0x1234567890abcdef1234567890abcdef12345678",
    type: "eoa",
    label: "your wallet",
  },
  {
    address: "0xABCDEF0123456789ABCDEF0123456789ABCDEF01",
    type: "timelock",
    label: "Timelock, 24h delay",
    detail: "via 2/3 Safe",
    safeAddress: "0x9999aaaa9999aaaa9999aaaa9999aaaa9999aaaa",
    delay: "24h",
  },
  {
    address: "0x9999aaaa9999aaaa9999aaaa9999aaaa9999aaaa",
    type: "safe",
    label: "3/5 Safe",
  },
  {
    address: "0x5678567856785678567856785678567856785678",
    type: "eoa",
    label: "PAUSER role",
  },
  {
    address: "0x9999999999999999999999999999999999999999",
    type: "eoa",
    label: "DEVELOPER role",
  },
];

/** Returns true when the logged-in identity is a Timelock wrapping a Safe */
export function isTimelockOverSafe(id: DemoIdentity): boolean {
  return id.type === "timelock" && !!id.safeAddress;
}

/** Safe address for the current identity (Safe login or Timelock-over-Safe) */
export function getSafeAddress(id: DemoIdentity): string | undefined {
  if (id.type === "safe") return id.address;
  if (id.type === "timelock") return id.safeAddress;
  return undefined;
}

export function formatIdentity(id: DemoIdentity): string {
  const short = id.address.slice(0, 6) + "..." + id.address.slice(-4);
  const parts = [`${short} (${id.label})`];
  if (id.detail) parts.push(id.detail);
  return parts.join(" ");
}

// Demo team members shown in app info / team list
export const DEMO_TEAM = {
  ADMIN: [
    DEMO_IDENTITIES[1], // Timelock(Safe)
  ],
  PAUSER: [
    DEMO_IDENTITIES[3], // EOA with PAUSER role
  ],
  DEVELOPER: [
    { address: "0x9999999999999999999999999999999999999999", type: "eoa" as IdentityType, label: "EOA" },
  ],
};
