import {
  and,
  eq
} from "drizzle-orm";
import type { SkrivebordDatabase } from "./client";
import {
  agentProfile,
  agentRun,
  conversationBinding
} from "./schema";

export type ConversationContext =
  | {
      type: "GENERAL";
    }
  | {
      type: "BOOKING";
      id: string;
    }
  | {
      type: "PROPERTY";
      id: string;
    };

function contextKey(
  context: ConversationContext
): string {
  if (context.type === "GENERAL") {
    return "GENERAL";
  }

  return `${context.type}:${context.id}`;
}

export async function getOrCreateConversationBinding(
  db: SkrivebordDatabase,
  input: {
    workspaceId: string;
    agentId: string;
    runtimeAgentKey: string;
    context: ConversationContext;
    now?: Date;
  }
) {
  const now = input.now ?? new Date();
  const key = contextKey(input.context);
  const contextId =
    input.context.type === "GENERAL"
      ? null
      : input.context.id;

  const [binding] = await db
    .insert(conversationBinding)
    .values({
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      contextType: input.context.type,
      contextId,
      contextKey: key,
      openclawSessionKey:
        `agent:${input.runtimeAgentKey}:skrivebord-${crypto.randomUUID()}`,
      lastUsedAt: now
    })
    .onConflictDoUpdate({
      target: [
        conversationBinding.workspaceId,
        conversationBinding.agentId,
        conversationBinding.contextKey
      ],
      set: {
        lastUsedAt: now
      }
    })
    .returning();

  if (!binding) {
    throw new Error(
      "CONVERSATION_BINDING_UPSERT_FAILED"
    );
  }

  return binding;
}

export async function touchConversationBinding(
  db: SkrivebordDatabase,
  input: {
    workspaceId: string;
    bindingId: string;
    now?: Date;
  }
): Promise<void> {
  await db
    .update(conversationBinding)
    .set({
      lastUsedAt: input.now ?? new Date()
    })
    .where(
      and(
        eq(
          conversationBinding.id,
          input.bindingId
        ),
        eq(
          conversationBinding.workspaceId,
          input.workspaceId
        )
      )
    );
}

export async function createAgentRun(
  db: SkrivebordDatabase,
  input: {
    workspaceId: string;
    agentId: string;
    runtimeAgentKey: string;
    gatewayRunId: string;
    sessionKey: string;
    requestedByPrincipalId: string;
    routeContext?: string;
    status?: string;
    now?: Date;
  }
) {
  const now = input.now ?? new Date();

  const [run] = await db
    .insert(agentRun)
    .values({
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      runtimeType: "OPENCLAW",
      runtimeAgentKey:
        input.runtimeAgentKey,
      gatewayRunId:
        input.gatewayRunId,
      sessionKey: input.sessionKey,
      requestedByPrincipalId:
        input.requestedByPrincipalId,
      routeContext:
        input.routeContext,
      status:
        input.status ?? "ACCEPTED",
      acceptedAt: now,
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: [
        agentRun.workspaceId,
        agentRun.gatewayRunId
      ],
      set: {
        status:
          input.status ?? "ACCEPTED",
        updatedAt: now
      }
    })
    .returning();

  if (!run) {
    throw new Error(
      "AGENT_RUN_CREATE_FAILED"
    );
  }

  await db
    .update(agentProfile)
    .set({
      status: "RUNNING",
      lastSeenAt: now,
      updatedAt: now
    })
    .where(
      and(
        eq(agentProfile.id, input.agentId),
        eq(
          agentProfile.workspaceId,
          input.workspaceId
        )
      )
    );

  return run;
}

export async function updateAgentRunStatus(
  db: SkrivebordDatabase,
  input: {
    workspaceId: string;
    gatewayRunId: string;
    status:
      | "ACCEPTED"
      | "RUNNING"
      | "SUCCEEDED"
      | "FAILED"
      | "CANCELLED";
    errorCode?: string;
    now?: Date;
  }
): Promise<void> {
  const now = input.now ?? new Date();
  const terminal = [
    "SUCCEEDED",
    "FAILED",
    "CANCELLED"
  ].includes(input.status);

  const [run] = await db
    .update(agentRun)
    .set({
      status: input.status,
      errorCode:
        input.errorCode ?? null,
      completedAt:
        terminal ? now : null,
      updatedAt: now
    })
    .where(
      and(
        eq(
          agentRun.workspaceId,
          input.workspaceId
        ),
        eq(
          agentRun.gatewayRunId,
          input.gatewayRunId
        )
      )
    )
    .returning({
      agentId: agentRun.agentId
    });

  if (!run) return;

  if (run.agentId) {
    await db
      .update(agentProfile)
      .set({
        status:
          input.status === "FAILED"
            ? "DEGRADED"
            : terminal
              ? "HEALTHY"
              : "RUNNING",
        lastSeenAt: now,
        updatedAt: now
      })
      .where(
        and(
          eq(
            agentProfile.id,
            run.agentId
          ),
          eq(
            agentProfile.workspaceId,
            input.workspaceId
          )
        )
      );
  }
}

export async function getRecentAgentRuns(
  db: SkrivebordDatabase,
  input: {
    workspaceId: string;
    agentId: string;
    limit?: number;
  }
) {
  return db
    .select()
    .from(agentRun)
    .where(
      and(
        eq(
          agentRun.workspaceId,
          input.workspaceId
        ),
        eq(
          agentRun.agentId,
          input.agentId
        )
      )
    )
    .limit(
      Math.min(
        Math.max(input.limit ?? 20, 1),
        100
      )
    );
}
