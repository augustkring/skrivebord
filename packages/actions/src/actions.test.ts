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


  it("replays a completed idempotent execution without repeating the side effect", async () => {
    const store = new InMemoryActionStore();
    let executions = 0;

    const idempotentDefinition = {
      id: "calendar.update",
      input: z.object({
        workspaceId: z.string(),
        eventId: z.string(),
        title: z.string()
      }).strict(),
      requiredCapabilities: ["today.manage"],
      risk: () => "LOW" as const,
      idempotency: "REQUIRED" as const,
      externalEffectRefs: (result: { providerEventId: string }) => [
        `google:event:${result.providerEventId}`
      ],
      execute: async () => {
        executions += 1;
        return {
          providerEventId: "event-1"
        };
      }
    };

    const first = await executeAction({
      definition: idempotentDefinition,
      principal: human,
      rawInput: {
        workspaceId: "ws_a",
        eventId: "event-1",
        title: "Flyttet"
      },
      idempotencyKey: "idem-1",
      store
    });

    const replay = await executeAction({
      definition: idempotentDefinition,
      principal: human,
      rawInput: {
        workspaceId: "ws_a",
        eventId: "event-1",
        title: "Flyttet"
      },
      idempotencyKey: "idem-1",
      store
    });

    expect(first.status).toBe("SUCCEEDED");
    expect(replay.status).toBe("SUCCEEDED");
    expect(replay.executionId).toBe(first.executionId);
    expect(replay.data).toEqual({
      providerEventId: "event-1"
    });
    expect(executions).toBe(1);
  });

  it("rejects idempotency key reuse with changed parameters", async () => {
    const store = new InMemoryActionStore();

    const idempotentDefinition = {
      id: "calendar.update",
      input: z.object({
        workspaceId: z.string(),
        eventId: z.string(),
        title: z.string()
      }).strict(),
      requiredCapabilities: ["today.manage"],
      risk: () => "LOW" as const,
      idempotency: "REQUIRED" as const,
      execute: async ({ input }: { input: { workspaceId: string; eventId: string; title: string } }) => ({
        title: input.title
      })
    };

    await executeAction({
      definition: idempotentDefinition,
      principal: human,
      rawInput: {
        workspaceId: "ws_a",
        eventId: "event-1",
        title: "A"
      },
      idempotencyKey: "idem-reused",
      store
    });

    const conflict = await executeAction({
      definition: idempotentDefinition,
      principal: human,
      rawInput: {
        workspaceId: "ws_a",
        eventId: "event-1",
        title: "B"
      },
      idempotencyKey: "idem-reused",
      store
    });

    expect(conflict.status).toBe("CONFLICT");
    expect(store.audit.at(-1)?.outcome).toBe(
      "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD"
    );
  });



  it("rejects idempotency key reuse across different action ids even with identical parameters", async () => {
    const store =
      new InMemoryActionStore();

    const input = z.object({
      workspaceId: z.string(),
      targetId: z.string()
    }).strict();

    const firstDefinition = {
      id: "calendar.move",
      input,
      requiredCapabilities: [
        "today.manage"
      ],
      risk: () => "LOW" as const,
      idempotency:
        "REQUIRED" as const,
      execute: async () => ({
        ok: true
      })
    };

    const secondDefinition = {
      ...firstDefinition,
      id: "calendar.delete"
    };

    await executeAction({
      definition:
        firstDefinition,
      principal: human,
      rawInput: {
        workspaceId: "ws_a",
        targetId: "event-1"
      },
      idempotencyKey:
        "shared-key",
      store
    });

    const conflict =
      await executeAction({
        definition:
          secondDefinition,
        principal: human,
        rawInput: {
          workspaceId: "ws_a",
          targetId: "event-1"
        },
        idempotencyKey:
          "shared-key",
        store
      });

    expect(
      conflict.status
    ).toBe("CONFLICT");
  });

  it("reuses the same pending approval for an idempotent review-required action", async () => {
    const store =
      new InMemoryActionStore();

    const reviewDefinition = {
      id: "calendar.move",
      input: z.object({
        workspaceId: z.string(),
        eventId: z.string(),
        startsAt: z.string()
      }).strict(),
      requiredCapabilities: [
        "message.send"
      ],
      risk: () =>
        "MEDIUM" as const,
      idempotency:
        "REQUIRED" as const,
      approval: {
        requiredApproverScope:
          "OWNER",
        consequenceSummary:
          () =>
            "Flytter en ekstern kalenderbegivenhed.",
        reversibility:
          "PARTIALLY_REVERSIBLE" as const
      },
      execute: async () => ({
        moved: true
      })
    };

    const first =
      await executeAction({
        definition:
          reviewDefinition,
        principal: agent,
        rawInput: {
          workspaceId: "ws_a",
          eventId: "event-1",
          startsAt:
            "2026-09-25T10:00:00Z"
        },
        idempotencyKey:
          "approval-idem-1",
        store
      });

    const replay =
      await executeAction({
        definition:
          reviewDefinition,
        principal: agent,
        rawInput: {
          workspaceId: "ws_a",
          eventId: "event-1",
          startsAt:
            "2026-09-25T10:00:00Z"
        },
        idempotencyKey:
          "approval-idem-1",
        store
      });

    expect(first.status).toBe(
      "PENDING_APPROVAL"
    );
    expect(replay.status).toBe(
      "PENDING_APPROVAL"
    );
    expect(
      replay.approvalId
    ).toBe(first.approvalId);
    expect(store.intents).toHaveLength(1);
    expect(store.approvals.size).toBe(1);
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
