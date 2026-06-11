import { describe, it, expect } from "vitest";
import { printAppDisplay } from "../format";

// Minimal FormattedAppDisplay stand-in (only fields printAppDisplay reads).
function fakeDisplay() {
  return {
    name: "n",
    id: "0xabc",
    releaseTime: "-",
    status: "Running",
    instance: "g1",
    ip: "1.2.3.4",
    cpu: "-",
    memory: "-",
    memoryUsage: "",
    evmAddresses: [],
    solanaAddresses: [],
    profile: undefined,
  } as any;
}

describe("printAppDisplay TLS line", () => {
  it("emits a TLS line referencing configure tls", () => {
    const lines: string[] = [];
    printAppDisplay(fakeDisplay(), (m) => lines.push(m), "  ", { showTls: true });
    const out = lines.join("\n");
    expect(out).toContain("TLS:");
    expect(out).toContain("configure tls");
  });

  it("prints TLS right after the IP line", () => {
    const lines: string[] = [];
    printAppDisplay(fakeDisplay(), (m) => lines.push(m), "  ", { showTls: true });
    const ipIdx = lines.findIndex((l) => l.includes("IP:"));
    const tlsIdx = lines.findIndex((l) => l.includes("TLS:"));
    expect(ipIdx).toBeGreaterThanOrEqual(0);
    expect(tlsIdx).toBe(ipIdx + 1);
  });

  it("omits the TLS line when showTls is not set (list mode)", () => {
    const lines: string[] = [];
    printAppDisplay(fakeDisplay(), (m) => lines.push(m));
    expect(lines.join("\n")).not.toContain("TLS:");
  });
});
