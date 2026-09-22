import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { PrincipalContext } from "@skrivebord/contracts";
import { executeAction, InMemoryActionStore } from "./index";

const human: PrincipalContext = {
  principalId: "u_lene",
  principalType: "HUMAN",
  workspaceId: "ws_a",
  roles: ["OWNER"],
  capabilities: ["today.manage", "message.send"],
  authStrength: "SESSION",
  source: "WEB",
  requestId: "req_1"
};

const agent: PrincipalContext = {
  principalId: "agent_mojn",
  principalType: "AGENT",
  workspaceId: "ws_a",
  roles: [],
  capabilities: ["message.send"],
  authStrength: "SESSION",
  source: "MCP",
  requestId: "req_agent"
};

const definition = {
  id: "today.complete",
  input: z.object({ workspaceId: z.string(), workItemId: z.string() }).strict(),
  requiredCapabilities: ["today.manage"],
  risk: () => "LOW" as const,
  preview: async () => "Markér arbejdet som færdigt",
  execute: async ({ input }: { input: { workspaceId: string; workItemId: string } }) => ({
    id: input.workItemId,
    status: "DONE"
  })
};

describe("Action Layer", () => {
  it("blocks a cross-workspace command before execution", async () => {
    const store = new InMemoryActionStore();
    const result = await executeAction({
      definition,
      principal: human,
      rawInput: { workspaceId: "ws_b", workItemId: "w_1" },
      store
    });
    expect(result.status).toBe("DENIED");
  });

  it("records intent and audit for permitted execution", async () => {
    const store = new InMemoryActionStore();
    const result = await executeAction({
      definition,
      principal: human,
      rawInput: { workspaceId: "ws_a", workItemId: "w_1" },
      store
    });
    expect(result.status).toBe("SUCCEEDED");
    expect(store.intents).toHaveLength(1);
    expect(store.intents[0]?.parametersDigest).toHaveLength(64);
    expect(store.audit.at(-1)?.outcome).toBe("SUCCEEDED");
  });

  it("persists an exact approval object when policy requires review", async () => {
    const store = new InMemoryActionStore();
    const sendDefinition = {
      id: "guest_message.send",
      input: z.object({
        workspaceId: z.string(),
        bookingId: z.string(),
        recipient: z.string().email(),
        body: z.string().min(1)
      }).strict(),
      requiredCapabilities: ["message.send"],
      risk: () => "MEDIUM" as const,
      externalCommunication: true,
      preview: async () => "Send ankomstinformation til Anna Jensen",
      approval: {
        requiredApproverScope: "OWNER",
        consequenceSummary: () => "Sender en ekstern e-mail til gæsten.",
        reversibility: "IRREVERSIBLE" as const
      },
      execute: async () => ({ sent: true })
    };

    const result = await executeAction({
      definition: sendDefinition,
      principal: agent,
      rawInput: {
        workspaceId: "ws_a",
        bookingId: "b_184",
        recipient: "anna@example.com",
        body: "Velkommen"
      },
      store,
      now: new Date("2026-09-22T10:00:00Z")
    });

    expect(result.status).toBe("PENDING_APPROVAL");
    expect(result.approvalId).toBeDefined();
    const approval = result.approvalId ? await store.getApproval(result.approvalId) : undefined;
    expect(approval?.state).toBe("PENDING");
    expect(approval?.parametersDigest).toHaveLength(64);
    expect(store.audit.at(-1)?.approvalId).toBe(result.approvalId);
  });
});
