import { describe, expect, it } from "vitest";
import type { PrincipalContext } from "@skrivebord/contracts";
import {
  consumeApproval,
  createBoundApproval,
  fingerprintTarget,
  resolveApproval,
  type ApprovalRecord,
  type ApprovalStore
} from "./approval";

class MemoryApprovals implements ApprovalStore {
  private records = new Map<string, ApprovalRecord>();

  async createApproval(approval: ApprovalRecord) {
    this.records.set(approval.id, approval);
  }

  async getApproval(id: string) {
    return this.records.get(id);
  }

  async saveApproval(approval: ApprovalRecord) {
    this.records.set(approval.id, approval);
  }
}

const human: PrincipalContext = {
  principalId: "user_lene",
  principalType: "HUMAN",
  workspaceId: "ws_a",
  roles: ["OWNER"],
  capabilities: ["approval.resolve"],
  authStrength: "STEP_UP",
  source: "WEB",
  requestId: "req_h"
};

const agent: PrincipalContext = {
  principalId: "agent_mojn",
  principalType: "AGENT",
  workspaceId: "ws_a",
  roles: [],
  capabilities: ["approval.resolve"],
  authStrength: "SESSION",
  source: "MCP",
  requestId: "req_a"
};

async function setup(expiresAt = new Date("2026-09-22T12:00:00Z")) {
  const store = new MemoryApprovals();
  const targetFingerprint = fingerprintTarget({
    workspaceId: "ws_a",
    actionId: "guest_message.send",
    targetType: "booking",
    targetId: "b_184",
    targetVersion: 3
  });
  const parameters = { recipient: "anna@example.com", body: "Velkommen" };
  const approval = createBoundApproval({
    id: "approval_1",
    workspaceId: "ws_a",
    actionIntentId: "intent_1",
    requestedByPrincipal: agent,
    requiredApproverScope: "OWNER",
    humanSummary: "Send ankomstinformation",
    consequenceSummary: "Sender en ekstern besked til gæsten",
    reversibility: "IRREVERSIBLE",
    targetFingerprint,
    parameters,
    createdAt: new Date("2026-09-22T10:00:00Z"),
    expiresAt
  });
  await store.createApproval(approval);
  return { store, parameters, targetFingerprint };
}

describe("approval binding", () => {
  it("forbids an agent from self-approving even if a capability is accidentally present", async () => {
    const { store, parameters, targetFingerprint } = await setup();
    const result = await resolveApproval({
      store,
      approvalId: "approval_1",
      principal: agent,
      decision: "APPROVE",
      currentParameters: parameters,
      currentTargetFingerprint: targetFingerprint,
      now: new Date("2026-09-22T10:30:00Z")
    });
    expect(result.status).toBe("DENIED");
  });

  it("supersedes approval when approved parameters change", async () => {
    const { store, parameters, targetFingerprint } = await setup();
    const result = await resolveApproval({
      store,
      approvalId: "approval_1",
      principal: human,
      decision: "APPROVE",
      currentParameters: { ...parameters, recipient: "other@example.com" },
      currentTargetFingerprint: targetFingerprint,
      now: new Date("2026-09-22T10:30:00Z")
    });
    expect(result.status).toBe("SUPERSEDED");
  });

  it("expires before resolution", async () => {
    const { store, parameters, targetFingerprint } = await setup(new Date("2026-09-22T10:15:00Z"));
    const result = await resolveApproval({
      store,
      approvalId: "approval_1",
      principal: human,
      decision: "APPROVE",
      currentParameters: parameters,
      currentTargetFingerprint: targetFingerprint,
      now: new Date("2026-09-22T10:30:00Z")
    });
    expect(result.status).toBe("EXPIRED");
  });

  it("cannot be consumed twice", async () => {
    const { store, parameters, targetFingerprint } = await setup();
    const resolved = await resolveApproval({
      store,
      approvalId: "approval_1",
      principal: human,
      decision: "APPROVE",
      currentParameters: parameters,
      currentTargetFingerprint: targetFingerprint,
      now: new Date("2026-09-22T10:30:00Z")
    });
    expect(resolved.status).toBe("APPROVED");

    await consumeApproval({ store, approvalId: "approval_1", currentParameters: parameters, currentTargetFingerprint: targetFingerprint });
    await expect(
      consumeApproval({ store, approvalId: "approval_1", currentParameters: parameters, currentTargetFingerprint: targetFingerprint })
    ).rejects.toThrow("APPROVAL_NOT_EXECUTABLE");
  });
});
