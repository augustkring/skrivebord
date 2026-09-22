import type { AuthStrength, PrincipalContext } from "@skrivebord/contracts";
import type { Capability } from "@skrivebord/policy";

export type HumanRole = "OWNER" | "MEMBER" | "VIEWER";

const ROLE_CAPABILITIES: Record<HumanRole, readonly Capability[]> = {
  OWNER: [
    "workspace.read",
    "today.read",
    "today.manage",
    "calendar.read",
    "calendar.create",
    "calendar.update",
    "calendar.delete",
    "booking.read",
    "booking.update",
    "property.read",
    "property.update",
    "yearplan.read",
    "yearplan.write",
    "message.draft",
    "message.send",
    "approval.read",
    "approval.resolve",
    "activity.read",
    "connection.read",
    "connection.manage",
    "agent.chat",
    "agent.policy.read",
    "agent.policy.manage",
    "agent.usage.read",
    "users.read",
    "users.manage",
    "security.credentials.manage"
  ],
  MEMBER: [
    "workspace.read",
    "today.read",
    "today.manage",
    "calendar.read",
    "calendar.create",
    "calendar.update",
    "booking.read",
    "booking.update",
    "property.read",
    "yearplan.read",
    "yearplan.write",
    "message.draft",
    "message.send",
    "approval.read",
    "activity.read",
    "connection.read",
    "agent.chat",
    "agent.policy.read",
    "agent.usage.read",
    "users.read"
  ],
  VIEWER: [
    "workspace.read",
    "today.read",
    "calendar.read",
    "booking.read",
    "property.read",
    "yearplan.read",
    "approval.read",
    "activity.read",
    "connection.read",
    "agent.policy.read",
    "agent.usage.read",
    "users.read"
  ]
};

export type HumanIdentity = {
  userId: string;
  workspaceId: string;
  role: HumanRole;
  authStrength: AuthStrength;
};

export type AgentIdentity = {
  agentId: string;
  workspaceId: string;
  capabilities: readonly Capability[];
};

export type SystemIdentity = {
  jobId: string;
  workspaceId: string;
  capabilities: readonly Capability[];
};

export function resolveHumanPrincipal(identity: HumanIdentity, requestId: string): PrincipalContext {
  return {
    principalId: identity.userId,
    principalType: "HUMAN",
    workspaceId: identity.workspaceId,
    roles: [identity.role],
    capabilities: [...ROLE_CAPABILITIES[identity.role]],
    authStrength: identity.authStrength,
    source: "WEB",
    requestId
  };
}

export function resolveAgentPrincipal(identity: AgentIdentity, requestId: string): PrincipalContext {
  return {
    principalId: identity.agentId,
    principalType: "AGENT",
    workspaceId: identity.workspaceId,
    roles: [],
    capabilities: [...identity.capabilities],
    authStrength: "SESSION",
    source: "MCP",
    requestId
  };
}

export function resolveSystemPrincipal(identity: SystemIdentity, requestId: string): PrincipalContext {
  return {
    principalId: identity.jobId,
    principalType: "SYSTEM",
    workspaceId: identity.workspaceId,
    roles: [],
    capabilities: [...identity.capabilities],
    authStrength: "SESSION",
    source: "SYSTEM",
    requestId
  };
}

export function assertPrincipalWorkspace(principal: PrincipalContext, workspaceId: string): void {
  if (principal.workspaceId !== workspaceId) {
    throw new Error("WORKSPACE_SCOPE_MISMATCH");
  }
}

export function requiresStepUp(principal: PrincipalContext): boolean {
  return principal.principalType === "HUMAN" && principal.authStrength !== "STEP_UP";
}


export type VerifiedApiKeyIdentity = {
  keyId: string;
  organizationId: string;
};

export type AgentCredentialBinding = {
  credentialId: string;
  agentId: string;
  workspaceId: string;
  enabled: boolean;
  capabilities: readonly Capability[];
};

export function resolveBoundAgentPrincipal(input: {
  verifiedKey: VerifiedApiKeyIdentity;
  binding: AgentCredentialBinding;
  requestId: string;
}): PrincipalContext | null {
  const { verifiedKey, binding, requestId } = input;

  if (!binding.enabled) return null;
  if (binding.credentialId !== verifiedKey.keyId) return null;
  if (binding.workspaceId !== verifiedKey.organizationId) return null;

  return resolveAgentPrincipal(
    {
      agentId: binding.agentId,
      workspaceId: binding.workspaceId,
      capabilities: binding.capabilities
    },
    requestId
  );
}
