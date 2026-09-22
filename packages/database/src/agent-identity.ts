import {
  and,
  eq,
  gt,
  isNull,
  or
} from "drizzle-orm";
import type { SkrivebordDatabase } from "./client";
import {
  agentCredentialBinding,
  agentProfile
} from "./schema";

export type BoundAgentCredential = {
  agentId: string;
  workspaceId: string;
  name: string;
  runtimeAgentKey: string;
  capabilities: string[];
  apiKeyId: string;
};

function normalizeCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.filter(
    (item): item is string =>
      typeof item === "string" && item.length > 0
  );
}

export async function bindAgentCredential(
  db: SkrivebordDatabase,
  input: {
    workspaceId: string;
    name: string;
    runtimeAgentKey: string;
    apiKeyId: string;
    capabilities: string[];
    expiresAt?: Date;
    now?: Date;
  }
): Promise<BoundAgentCredential> {
  const now = input.now ?? new Date();

  const [agent] = await db
    .insert(agentProfile)
    .values({
      workspaceId: input.workspaceId,
      name: input.name,
      runtimeType: "OPENCLAW",
      runtimeAgentKey: input.runtimeAgentKey,
      enabled: true,
      status: "UNKNOWN",
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: [
        agentProfile.workspaceId,
        agentProfile.runtimeAgentKey
      ],
      set: {
        name: input.name,
        enabled: true,
        updatedAt: now
      }
    })
    .returning({
      id: agentProfile.id,
      workspaceId: agentProfile.workspaceId,
      name: agentProfile.name,
      runtimeAgentKey:
        agentProfile.runtimeAgentKey
    });

  if (!agent) {
    throw new Error("AGENT_PROFILE_UPSERT_FAILED");
  }

  await db
    .insert(agentCredentialBinding)
    .values({
      workspaceId: input.workspaceId,
      agentId: agent.id,
      apiKeyId: input.apiKeyId,
      enabled: true,
      capabilities: input.capabilities,
      createdAt: now,
      expiresAt: input.expiresAt
    })
    .onConflictDoUpdate({
      target: agentCredentialBinding.apiKeyId,
      set: {
        workspaceId: input.workspaceId,
        agentId: agent.id,
        enabled: true,
        capabilities: input.capabilities,
        expiresAt: input.expiresAt,
        revokedAt: null
      }
    });

  return {
    agentId: agent.id,
    workspaceId: agent.workspaceId,
    name: agent.name,
    runtimeAgentKey: agent.runtimeAgentKey,
    capabilities: input.capabilities,
    apiKeyId: input.apiKeyId
  };
}

export async function getBoundAgentCredential(
  db: SkrivebordDatabase,
  input: {
    workspaceId: string;
    apiKeyId: string;
    now?: Date;
  }
): Promise<BoundAgentCredential | undefined> {
  const now = input.now ?? new Date();

  const [row] = await db
    .select({
      agentId: agentProfile.id,
      workspaceId: agentProfile.workspaceId,
      name: agentProfile.name,
      runtimeAgentKey:
        agentProfile.runtimeAgentKey,
      capabilities:
        agentCredentialBinding.capabilities,
      apiKeyId:
        agentCredentialBinding.apiKeyId
    })
    .from(agentCredentialBinding)
    .innerJoin(
      agentProfile,
      and(
        eq(
          agentCredentialBinding.agentId,
          agentProfile.id
        ),
        eq(
          agentCredentialBinding.workspaceId,
          agentProfile.workspaceId
        )
      )
    )
    .where(
      and(
        eq(
          agentCredentialBinding.workspaceId,
          input.workspaceId
        ),
        eq(
          agentCredentialBinding.apiKeyId,
          input.apiKeyId
        ),
        eq(
          agentCredentialBinding.enabled,
          true
        ),
        eq(agentProfile.enabled, true),
        isNull(
          agentCredentialBinding.revokedAt
        ),
        or(
          isNull(
            agentCredentialBinding.expiresAt
          ),
          gt(
            agentCredentialBinding.expiresAt,
            now
          )
        )
      )
    )
    .limit(1);

  if (!row) return undefined;

  return {
    agentId: row.agentId,
    workspaceId: row.workspaceId,
    name: row.name,
    runtimeAgentKey: row.runtimeAgentKey,
    capabilities: normalizeCapabilities(
      row.capabilities
    ),
    apiKeyId: row.apiKeyId
  };
}

export async function touchAgentCredential(
  db: SkrivebordDatabase,
  input: {
    workspaceId: string;
    apiKeyId: string;
    now?: Date;
  }
): Promise<void> {
  await db
    .update(agentCredentialBinding)
    .set({
      lastUsedAt: input.now ?? new Date()
    })
    .where(
      and(
        eq(
          agentCredentialBinding.workspaceId,
          input.workspaceId
        ),
        eq(
          agentCredentialBinding.apiKeyId,
          input.apiKeyId
        ),
        eq(
          agentCredentialBinding.enabled,
          true
        )
      )
    );
}

export async function revokeAgentCredential(
  db: SkrivebordDatabase,
  input: {
    workspaceId: string;
    apiKeyId: string;
    now?: Date;
  }
): Promise<void> {
  const now = input.now ?? new Date();

  await db
    .update(agentCredentialBinding)
    .set({
      enabled: false,
      revokedAt: now
    })
    .where(
      and(
        eq(
          agentCredentialBinding.workspaceId,
          input.workspaceId
        ),
        eq(
          agentCredentialBinding.apiKeyId,
          input.apiKeyId
        )
      )
    );
}

export function intersectAgentCapabilities<T extends string>(
  apiKeyCapabilities: readonly T[],
  bindingCapabilities: readonly string[]
): T[] {
  const allowed = new Set(
    bindingCapabilities
  );

  return apiKeyCapabilities.filter(
    (capability) => allowed.has(capability)
  );
}


export async function getAgentProvisioningState(
  db: SkrivebordDatabase,
  input: {
    workspaceId: string;
    runtimeAgentKey: string;
    now?: Date;
  }
): Promise<{
  agentId: string;
  name: string;
  runtimeAgentKey: string;
  enabled: boolean;
  activeCredential?: {
    apiKeyId: string;
    capabilities: string[];
    expiresAt?: Date;
    lastUsedAt?: Date;
  };
} | undefined> {
  const now = input.now ?? new Date();

  const [agent] = await db
    .select({
      id: agentProfile.id,
      name: agentProfile.name,
      runtimeAgentKey:
        agentProfile.runtimeAgentKey,
      enabled: agentProfile.enabled
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
        )
      )
    )
    .limit(1);

  if (!agent) return undefined;

  const [binding] = await db
    .select({
      apiKeyId:
        agentCredentialBinding.apiKeyId,
      capabilities:
        agentCredentialBinding.capabilities,
      expiresAt:
        agentCredentialBinding.expiresAt,
      lastUsedAt:
        agentCredentialBinding.lastUsedAt
    })
    .from(agentCredentialBinding)
    .where(
      and(
        eq(
          agentCredentialBinding.workspaceId,
          input.workspaceId
        ),
        eq(
          agentCredentialBinding.agentId,
          agent.id
        ),
        eq(
          agentCredentialBinding.enabled,
          true
        ),
        isNull(
          agentCredentialBinding.revokedAt
        ),
        or(
          isNull(
            agentCredentialBinding.expiresAt
          ),
          gt(
            agentCredentialBinding.expiresAt,
            now
          )
        )
      )
    )
    .limit(1);

  return {
    agentId: agent.id,
    name: agent.name,
    runtimeAgentKey:
      agent.runtimeAgentKey,
    enabled: agent.enabled,
    activeCredential: binding
      ? {
          apiKeyId:
            binding.apiKeyId,
          capabilities:
            normalizeCapabilities(
              binding.capabilities
            ),
          expiresAt:
            binding.expiresAt ??
            undefined,
          lastUsedAt:
            binding.lastUsedAt ??
            undefined
        }
      : undefined
  };
}
