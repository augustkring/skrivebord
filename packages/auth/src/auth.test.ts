import { describe, expect, it } from "vitest";
import { assertPrincipalWorkspace, resolveAgentPrincipal, resolveHumanPrincipal, requiresStepUp } from "./index";

describe("principal resolution", () => {
  it("keeps humans and agents as distinct principal types", () => {
    const human = resolveHumanPrincipal({ userId: "user_lene", workspaceId: "ws_a", role: "OWNER", authStrength: "SESSION" }, "req_h");
    const agent = resolveAgentPrincipal({ agentId: "agent_mojn", workspaceId: "ws_a", capabilities: ["today.read", "calendar.update"] }, "req_a");

    expect(human.principalType).toBe("HUMAN");
    expect(agent.principalType).toBe("AGENT");
    expect(agent.principalId).not.toBe(human.principalId);
    expect(agent.capabilities).not.toContain("approval.resolve");
  });

  it("binds a principal to exactly one workspace", () => {
    const human = resolveHumanPrincipal({ userId: "user_lene", workspaceId: "ws_a", role: "OWNER", authStrength: "SESSION" }, "req_h");
    expect(() => assertPrincipalWorkspace(human, "ws_b")).toThrow("WORKSPACE_SCOPE_MISMATCH");
  });

  it("requires explicit step-up state for sensitive owner operations", () => {
    const session = resolveHumanPrincipal({ userId: "user_lene", workspaceId: "ws_a", role: "OWNER", authStrength: "SESSION" }, "req_1");
    const steppedUp = resolveHumanPrincipal({ userId: "user_lene", workspaceId: "ws_a", role: "OWNER", authStrength: "STEP_UP" }, "req_2");
    expect(requiresStepUp(session)).toBe(true);
    expect(requiresStepUp(steppedUp)).toBe(false);
  });
});
