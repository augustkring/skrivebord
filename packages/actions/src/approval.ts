import { createHash } from "node:crypto";
import type { PrincipalContext } from "@skrivebord/contracts";

export type ApprovalState =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "REVOKED"
  | "CONSUMED"
  | "SUPERSEDED";

export type ApprovalRecord = {
  id: string;
  workspaceId: string;
  actionIntentId: string;
  requestedByPrincipalId: string;
  requestedByPrincipalType: PrincipalContext["principalType"];
  requiredApproverScope: string;
  humanSummary: string;
  consequenceSummary: string;
  reversibility: "REVERSIBLE" | "PARTIALLY_REVERSIBLE" | "IRREVERSIBLE";
  targetFingerprint: string;
  parametersDigest: string;
  state: ApprovalState;
  createdAt: string;
  expiresAt: string;
  resolvedAt?: string;
  resolvedByPrincipalId?: string;
  decision?: "APPROVE" | "REJECT";
};

export interface ApprovalStore {
  createApproval(approval: ApprovalRecord): Promise<void>;
  getApproval(id: string): Promise<ApprovalRecord | undefined>;
  saveApproval(approval: ApprovalRecord): Promise<void>;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, canonicalize(nested)])
    );
  }
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function digestParameters(parameters: unknown): string {
  return sha256(JSON.stringify(canonicalize(parameters)));
}

export function fingerprintTarget(input: {
  workspaceId: string;
  actionId: string;
  targetType?: string;
  targetId?: string;
  targetVersion?: string | number;
}): string {
  return sha256([
    input.workspaceId,
    input.actionId,
    input.targetType ?? "",
    input.targetId ?? "",
    input.targetVersion?.toString() ?? ""
  ].join(":"));
}

export function createBoundApproval(input: {
  id: string;
  workspaceId: string;
  actionIntentId: string;
  requestedByPrincipal: PrincipalContext;
  requiredApproverScope: string;
  humanSummary: string;
  consequenceSummary: string;
  reversibility: ApprovalRecord["reversibility"];
  targetFingerprint: string;
  parameters: unknown;
  createdAt: Date;
  expiresAt: Date;
}): ApprovalRecord {
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    actionIntentId: input.actionIntentId,
    requestedByPrincipalId: input.requestedByPrincipal.principalId,
    requestedByPrincipalType: input.requestedByPrincipal.principalType,
    requiredApproverScope: input.requiredApproverScope,
    humanSummary: input.humanSummary,
    consequenceSummary: input.consequenceSummary,
    reversibility: input.reversibility,
    targetFingerprint: input.targetFingerprint,
    parametersDigest: digestParameters(input.parameters),
    state: "PENDING",
    createdAt: input.createdAt.toISOString(),
    expiresAt: input.expiresAt.toISOString()
  };
}

export type ResolveApprovalResult =
  | { status: "APPROVED"; approval: ApprovalRecord }
  | { status: "REJECTED"; approval: ApprovalRecord }
  | { status: "EXPIRED"; approval: ApprovalRecord }
  | { status: "SUPERSEDED"; approval: ApprovalRecord }
  | { status: "DENIED"; reason: string }
  | { status: "NOT_FOUND" }
  | { status: "ALREADY_RESOLVED"; approval: ApprovalRecord };

export async function resolveApproval(input: {
  store: ApprovalStore;
  approvalId: string;
  principal: PrincipalContext;
  decision: "APPROVE" | "REJECT";
  currentParameters: unknown;
  currentTargetFingerprint: string;
  now?: Date;
}): Promise<ResolveApprovalResult> {
  const approval = await input.store.getApproval(input.approvalId);
  if (!approval) return { status: "NOT_FOUND" };

  if (
    input.principal.principalType !== "HUMAN" ||
    !input.principal.capabilities.includes("approval.resolve") ||
    input.principal.workspaceId !== approval.workspaceId
  ) {
    return { status: "DENIED", reason: "Kun en autoriseret human principal i samme workspace må afgøre business approvals." };
  }

  if (approval.state !== "PENDING") {
    return { status: "ALREADY_RESOLVED", approval };
  }

  const now = input.now ?? new Date();
  if (now.getTime() >= new Date(approval.expiresAt).getTime()) {
    const expired = { ...approval, state: "EXPIRED" as const };
    await input.store.saveApproval(expired);
    return { status: "EXPIRED", approval: expired };
  }

  const parametersChanged = digestParameters(input.currentParameters) !== approval.parametersDigest;
  const targetChanged = input.currentTargetFingerprint !== approval.targetFingerprint;
  if (parametersChanged || targetChanged) {
    const superseded = { ...approval, state: "SUPERSEDED" as const };
    await input.store.saveApproval(superseded);
    return { status: "SUPERSEDED", approval: superseded };
  }

  if (input.decision === "REJECT") {
    const rejected: ApprovalRecord = {
      ...approval,
      state: "REJECTED",
      resolvedAt: now.toISOString(),
      resolvedByPrincipalId: input.principal.principalId,
      decision: "REJECT"
    };
    await input.store.saveApproval(rejected);
    return { status: "REJECTED", approval: rejected };
  }

  const approved: ApprovalRecord = {
    ...approval,
    state: "APPROVED",
    resolvedAt: now.toISOString(),
    resolvedByPrincipalId: input.principal.principalId,
    decision: "APPROVE"
  };
  await input.store.saveApproval(approved);
  return { status: "APPROVED", approval: approved };
}

export async function consumeApproval(input: {
  store: ApprovalStore;
  approvalId: string;
  currentParameters: unknown;
  currentTargetFingerprint: string;
}): Promise<ApprovalRecord> {
  const approval = await input.store.getApproval(input.approvalId);
  if (!approval) throw new Error("APPROVAL_NOT_FOUND");
  if (approval.state !== "APPROVED") throw new Error("APPROVAL_NOT_EXECUTABLE");

  if (
    digestParameters(input.currentParameters) !== approval.parametersDigest ||
    input.currentTargetFingerprint !== approval.targetFingerprint
  ) {
    const superseded = { ...approval, state: "SUPERSEDED" as const };
    await input.store.saveApproval(superseded);
    throw new Error("APPROVAL_SUPERSEDED");
  }

  const consumed = { ...approval, state: "CONSUMED" as const };
  await input.store.saveApproval(consumed);
  return consumed;
}
