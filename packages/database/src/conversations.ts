import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { SkrivebordDatabase } from "./client";
import {
  agentProfile,
  agentRun,
  conversationBinding
} from "./schema";

export type ConversationContext =
  | { type: "GENERAL" }
  | { type: "BOOKING"; id: string }
  | { type: "PROPERTY"; id: string };

export type ConversationBindingResult = {
  id: string;
  workspaceId: string;
  agentId: string;
  runtimeAgentKey: string;
  contextType: ConversationContext["type"];
  contextId?: string;
  contextKey: string;
  openclawSessionKey: string;
  lastUsedAt: Date;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export function conversationContextKey(
  context: ConversationContext
): string {
  if (context.type === "GENERAL") {
    return "GENERAL";
  }

  if (!isUuid(context.id)) {
    throw new Error("CONVERSATION_CONTEXT_ID_MUST_BE_UUID");
  }

  return `${context.type}:${context.id.toLowerCase()}`;
}

function workspaceSessionNamespace(
  workspaceId: string
): string {
  return createHash("sha256")
    .update(workspaceId)
    .digest("hex")
    .slice(0, 16);
}

export function buildOpenClawSessionKey(input: {
  workspaceId: string;
  runtimeAgentKey: string;
  context: ConversationContext;
}): string {
  const runtimeAgentKey =
    input.runtimeAgentKey.trim();

  if (
    !runtimeAgentKey ||
    runtimeAgentKey.includes(":")
  ) {
    throw new Error(
      "INVALID_OPENCLAW_AGENT_KEY"
    );
  }

  const namespace =
    workspaceSessionNamespace(
      input.workspaceId
    );
  const contextKey =
    conversationContextKey(
      input.context
    )
      .toLowerCase();

  return `agent:${runtimeAgentKey}:skrivebord:${namespace}:${contextKey}`;
}

export async function getOrCreateConversationBinding(
  db: SkrivebordDatabase,
  input: {
    workspaceId: string;
    runtimeAgentKey: string;
    context: ConversationContext;
    now?: Date;
  }
): Promise<ConversationBindingResult> {
  const now = input.now ?? new Date();

  const [agent] = await db
    .select({
      id: agentProfile.id,
      workspaceId:
        agentProfile.workspaceId,
      runtimeAgentKey:
        agentProfile.runtimeAgentKey
    })
    .from(agentProfile)
    .where(
      and(
        eq(
          agentProfile.workspaceId,
          input.workspaceId
        ),
        eq(
          agentProfile.runtimeAgentKey,
          input.runtimeAgentKey
        ),
        eq(
          agentProfile.enabled,
          true
        )
      )
    )
    .limit(1);

  if (!agent) {
    throw new Error(
      "ACTIVE_AGENT_PROFILE_NOT_FOUND"
    );
  }

  const contextKey =
    conversationContextKey(
      input.context
    );
  const openclawSessionKey =
    buildOpenClawSessionKey({
      workspaceId:
        input.workspaceId,
      runtimeAgentKey:
        agent.runtimeAgentKey,
      context: input.context
    });

  const [binding] = await db
    .insert(conversationBinding)
    .values({
      workspaceId:
        input.workspaceId,
      agentId: agent.id,
      contextType:
        input.context.type,
      contextId:
        input.context.type ===
        "GENERAL"
          ? null
          : input.context.id,
      contextKey,
      openclawSessionKey,
      createdAt: now,
      lastUsedAt: now
    })
    .onConflictDoUpdate({
      target: [
        conversationBinding.workspaceId,
        conversationBinding.agentId,
        conversationBinding.contextKey
      ],
      set: {
        openclawSessionKey,
        lastUsedAt: now
      }
    })
    .returning();

  if (!binding) {
    throw new Error(
      "CONVERSATION_BINDING_UPSERT_FAILED"
    );
  }

  return {
    id: binding.id,
    workspaceId:
      binding.workspaceId,
    agentId:
      binding.agentId,
    runtimeAgentKey:
      agent.runtimeAgentKey,
    contextType:
      binding.contextType as
        ConversationContext["type"],
    contextId:
      binding.contextId ??
      undefined,
    contextKey:
      binding.contextKey,
    openclawSessionKey:
      binding.openclawSessionKey,
    lastUsedAt:
      binding.lastUsedAt
  };
}

export async function recordAcceptedAgentRun(
  db: SkrivebordDatabase,
  input: {
    workspaceId: string;
    agentId: string;
    runtimeAgentKey: string;
    gatewayRunId: string;
    sessionKey: string;
    requestedByPrincipalId: string;
    routeContext?: string;
    now?: Date;
  }
) {
  const now = input.now ?? new Date();

  const [run] = await db
    .insert(agentRun)
    .values({
      workspaceId:
        input.workspaceId,
      agentId: input.agentId,
      runtimeType: "OPENCLAW",
      runtimeAgentKey:
        input.runtimeAgentKey,
      gatewayRunId:
        input.gatewayRunId,
      sessionKey:
        input.sessionKey,
      requestedByPrincipalId:
        input.requestedByPrincipalId,
      routeContext:
        input.routeContext,
      status: "ACCEPTED",
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
        sessionKey:
          input.sessionKey,
        routeContext:
          input.routeContext,
        updatedAt: now
      }
    })
    .returning();

  if (!run) {
    throw new Error(
      "AGENT_RUN_RECORD_FAILED"
    );
  }

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
      | "WAITING"
      | "SUCCEEDED"
      | "FAILED"
      | "CANCELLED";
    errorCode?: string;
    completedAt?: Date;
    now?: Date;
  }
): Promise<void> {
  const now = input.now ?? new Date();

  await db
    .update(agentRun)
    .set({
      status: input.status,
      errorCode:
        input.errorCode ?? null,
      completedAt:
        input.completedAt ??
        ([
          "SUCCEEDED",
          "FAILED",
          "CANCELLED"
        ].includes(input.status)
          ? now
          : null),
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
    );
}

export async function listRecentAgentRuns(
  db: SkrivebordDatabase,
  input: {
    workspaceId: string;
    limit?: number;
  }
) {
  return db.query.agentRun.findMany({
    where: (
      table,
      { eq: eqOp }
    ) =>
      eqOp(
        table.workspaceId,
        input.workspaceId
      ),
    orderBy: (
      table,
      { desc }
    ) => [
      desc(table.createdAt)
    ],
    limit:
      Math.min(
        Math.max(
          input.limit ?? 20,
          1
        ),
        100
      )
  });
}


export async function markAgentRuntimeStatus(
  db: SkrivebordDatabase,
  input: {
    workspaceId: string;
    runtimeAgentKey: string;
    status:
      | "UNKNOWN"
      | "READY"
      | "UNAVAILABLE"
      | "ERROR";
    seenAt?: Date;
    now?: Date;
  }
): Promise<void> {
  const now = input.now ?? new Date();

  await db
    .update(agentProfile)
    .set({
      status: input.status,
      lastSeenAt:
        input.seenAt ??
        (input.status === "READY"
          ? now
          : undefined),
      updatedAt: now
    })
    .where(
      and(
        eq(
          agentProfile.workspaceId,
          input.workspaceId
        ),
        eq(
          agentProfile.runtimeAgentKey,
          input.runtimeAgentKey
        )
      )
    );
}


export async function getAgentRun(
  db: SkrivebordDatabase,
  input: {
    workspaceId: string;
    gatewayRunId: string;
  }
) {
  const [run] = await db
    .select()
    .from(agentRun)
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
    .limit(1);

  return run;
}
