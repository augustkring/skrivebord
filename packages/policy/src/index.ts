import type {
  PolicyDecision,
  PrincipalContext,
  RiskLevel
} from "@skrivebord/contracts";

export const CAPABILITIES = [
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
] as const;

export type Capability =
  (typeof CAPABILITIES)[number];

export const MOJN_V1_CAPABILITIES = [
  "workspace.read",
  "today.read",
  "today.manage",
  "calendar.read",
  "booking.read",
  "yearplan.read",
  "activity.read",
  "agent.chat"
] as const satisfies readonly Capability[];

export function hasCapabilities(
  principal: PrincipalContext,
  required: readonly string[]
): boolean {
  return required.every((capability) =>
    principal.capabilities.includes(
      capability
    )
  );
}

export function evaluateActionPolicy(input: {
  principal: PrincipalContext;
  requiredCapabilities: readonly string[];
  risk: RiskLevel;
  explicitlyDelegated?: boolean;
  reversible?: boolean;
  externalCommunication?: boolean;
}): PolicyDecision {
  const {
    principal,
    requiredCapabilities,
    risk,
    explicitlyDelegated = false,
    reversible = false,
    externalCommunication = false
  } = input;

  if (
    !hasCapabilities(
      principal,
      requiredCapabilities
    )
  ) {
    return {
      type: "DENY",
      reason:
        "Principal mangler nødvendig capability."
    };
  }

  if (
    principal.principalType === "AGENT" &&
    requiredCapabilities.some((capability) =>
      [
        "approval.resolve",
        "connection.manage",
        "users.manage",
        "security.credentials.manage"
      ].includes(capability)
    )
  ) {
    return {
      type: "DENY",
      reason:
        "Agent-principaler må ikke administrere approvals, forbindelser, brugere eller credentials."
    };
  }

  if (
    risk === "CRITICAL" ||
    risk === "HIGH"
  ) {
    return {
      type: "REVIEW_REQUIRED",
      reason:
        "Handlingen har høj konsekvens eller lav reversibilitet."
    };
  }

  if (
    externalCommunication &&
    principal.principalType === "AGENT"
  ) {
    return {
      type: "REVIEW_REQUIRED",
      reason:
        "Fri ekstern kommunikation kræver menneskelig gennemgang i V1."
    };
  }

  if (
    risk === "MEDIUM" &&
    principal.principalType === "AGENT" &&
    !(
      explicitlyDelegated &&
      reversible
    )
  ) {
    return {
      type: "REVIEW_REQUIRED",
      reason:
        "Agenthandlingen er medium risiko og er ikke både eksplicit delegeret og reversibel."
    };
  }

  return { type: "AUTO" };
}
