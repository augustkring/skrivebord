import { describe, expect, it } from "vitest";
import { resolveBoundAgentPrincipal } from "./index";

describe("agent credential binding", () => {
  const binding = {
    credentialId: "key_1",
    agentId: "agent_mojn",
    workspaceId: "ws_a",
    enabled: true,
    capabilities: ["today.read", "calendar.update"] as const
  };

  it("resolves a verified organization key to an agent principal", () => {
    const principal = resolveBoundAgentPrincipal({
      verifiedKey: { keyId: "key_1", organizationId: "ws_a" },
      binding,
      requestId: "req_1"
    });

    expect(principal?.principalType).toBe("AGENT");
    expect(principal?.workspaceId).toBe("ws_a");
    expect(principal?.capabilities).toEqual(["today.read", "calendar.update"]);
  });

  it("rejects a valid key when organization and binding workspace differ", () => {
    const principal = resolveBoundAgentPrincipal({
      verifiedKey: { keyId: "key_1", organizationId: "ws_b" },
      binding,
      requestId: "req_2"
    });

    expect(principal).toBeNull();
  });

  it("rejects a disabled credential binding", () => {
    const principal = resolveBoundAgentPrincipal({
      verifiedKey: { keyId: "key_1", organizationId: "ws_a" },
      binding: { ...binding, enabled: false },
      requestId: "req_3"
    });

    expect(principal).toBeNull();
  });
});
