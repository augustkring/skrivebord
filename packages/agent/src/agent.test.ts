import { describe, expect, it } from "vitest";
import type { PrincipalContext } from "@skrivebord/contracts";
import { buildAlsLebenSnapshot } from "@skrivebord/domain";
import {
  getTodayForAgent,
  listBookingsForAgent,
  normalizeAgentCapabilities
} from "./index";

function agent(workspaceId: string, capabilities: string[]): PrincipalContext {
  return {
    principalId: "agent-key:key_1",
    principalType: "AGENT",
    workspaceId,
    roles: [],
    capabilities,
    authStrength: "SESSION",
    source: "MCP",
    requestId: "req_1"
  };
}

describe("agent query tools", () => {
  it("filters unknown API-key permissions", () => {
    expect(
      normalizeAgentCapabilities({
        skrivebord: ["today.read", "sql.query", "booking.read"]
      })
    ).toEqual(["today.read", "booking.read"]);
  });

  it("denies cross-workspace reads", () => {
    const snapshot = buildAlsLebenSnapshot("ws_a");
    const result = listBookingsForAgent(agent("ws_b", ["booking.read"]), snapshot);
    expect(result.status).toBe("DENIED");
  });

  it("denies ungranted capabilities", () => {
    const snapshot = buildAlsLebenSnapshot("ws_a");
    const result = getTodayForAgent(
      agent("ws_a", []),
      snapshot,
      new Date("2026-09-22T08:00:00+02:00")
    );
    expect(result.status).toBe("DENIED");
  });

  it("returns deterministic Today data without AI", () => {
    const snapshot = buildAlsLebenSnapshot("ws_a");
    const result = getTodayForAgent(
      agent("ws_a", ["today.read"]),
      snapshot,
      new Date("2026-09-22T08:00:00+02:00")
    );
    expect(result.status).toBe("SUCCEEDED");
    expect(result.data?.requiresYou.length).toBeGreaterThan(0);
  });
});
