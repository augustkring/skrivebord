import { describe, expect, it } from "vitest";
import type { PrincipalContext } from "@skrivebord/contracts";
import { evaluateActionPolicy } from "./index";
const agent: PrincipalContext = { principalId: "agent_mojn", principalType: "AGENT", workspaceId: "ws_a", roles: [], capabilities: ["calendar.update", "approval.resolve"], authStrength: "SESSION", source: "MCP", requestId: "req_1" };
describe("policy", () => {
  it("forbids agent self-approval", () => expect(evaluateActionPolicy({ principal: agent, requiredCapabilities: ["approval.resolve"], risk: "LOW" }).type).toBe("DENY"));
  it("permits explicitly delegated reversible medium-risk work", () => expect(evaluateActionPolicy({ principal: agent, requiredCapabilities: ["calendar.update"], risk: "MEDIUM", explicitlyDelegated: true, reversible: true }).type).toBe("AUTO"));
  it("requires review without delegation", () => expect(evaluateActionPolicy({ principal: agent, requiredCapabilities: ["calendar.update"], risk: "MEDIUM", reversible: true }).type).toBe("REVIEW_REQUIRED"));
});
