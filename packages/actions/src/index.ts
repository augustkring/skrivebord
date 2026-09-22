import type { PolicyDecision, PrincipalContext, RiskLevel, ToolResult } from "@skrivebord/contracts";
import { evaluateActionPolicy } from "@skrivebord/policy";
import type { z } from "zod";
import {
  createBoundApproval,
  digestParameters,
  fingerprintTarget,
  type ApprovalRecord,
  type ApprovalStore
} from "./approval";

export * from "./approval";

export type ActionContext<Input> = {
  principal: PrincipalContext;
  input: Input;
  now: Date;
};

export type ActionApprovalDefinition<Input> = {
  requiredApproverScope: string;
  consequenceSummary: (ctx: ActionContext<Input>) => string;
  reversibility: ApprovalRecord["reversibility"];
  expiresInMs?: number;
  targetFingerprint?: (ctx: ActionContext<Input>) => string;
};

export type ActionDefinition<Input, Result> = {
  id: string;
  input: z.ZodType<Input>;
  requiredCapabilities: string[];
  risk: (ctx: ActionContext<Input>) => RiskLevel;
  authorize?: (ctx: ActionContext<Input>) => Promise<boolean>;
  preview?: (ctx: ActionContext<Input>) => Promise<string>;
  execute: (ctx: ActionContext<Input>) => Promise<Result>;
  approval?: ActionApprovalDefinition<Input>;
  reversible?: boolean;
  externalCommunication?: boolean;
};

export type ActionIntentRecord = {
  id: string;
  workspaceId: string;
  actionId: string;
  requestedByPrincipalId: string;
  requestedByPrincipalType: string;
  parameters: unknown;
  parametersDigest: string;
  humanSummary: string;
  riskLevel: RiskLevel;
  policyDecision: PolicyDecision["type"];
  state: "PENDING" | "WAITING_APPROVAL" | "SUCCEEDED" | "FAILED";
  createdAt: string;
};

export interface ActionStore extends ApprovalStore {
  createIntent(intent: ActionIntentRecord): Promise<void>;
  appendAudit(event: {
    workspaceId: string;
    actorId: string;
    actionId: string;
    intentId: string;
    approvalId?: string;
    outcome: string;
    occurredAt: string;
  }): Promise<void>;
}

export class InMemoryActionStore implements ActionStore {
  intents: ActionIntentRecord[] = [];
  approvals = new Map<string, ApprovalRecord>();
  audit: Array<{
    workspaceId: string;
    actorId: string;
    actionId: string;
    intentId: string;
    approvalId?: string;
    outcome: string;
    occurredAt: string;
  }> = [];

  async createIntent(intent: ActionIntentRecord) {
    this.intents.push(intent);
  }

  async createApproval(approval: ApprovalRecord) {
    this.approvals.set(approval.id, approval);
  }

  async getApproval(id: string) {
    return this.approvals.get(id);
  }

  async saveApproval(approval: ApprovalRecord) {
    this.approvals.set(approval.id, approval);
  }

  async appendAudit(event: {
    workspaceId: string;
    actorId: string;
    actionId: string;
    intentId: string;
    approvalId?: string;
    outcome: string;
    occurredAt: string;
  }) {
    this.audit.push(event);
  }
}

function intentId(requestId: string, actionId: string): string {
  return `intent:${requestId}:${actionId}`;
}

function readWorkspaceId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("workspaceId" in value)) return undefined;
  const workspaceId = (value as { workspaceId?: unknown }).workspaceId;
  return typeof workspaceId === "string" ? workspaceId : undefined;
}

export async function executeAction<Input, Result>(args: {
  definition: ActionDefinition<Input, Result>;
  principal: PrincipalContext;
  rawInput: unknown;
  store: ActionStore;
  now?: Date;
  explicitlyDelegated?: boolean;
}): Promise<ToolResult<Result>> {
  const parsed = args.definition.input.safeParse(args.rawInput);
  if (!parsed.success) {
    return { status: "FAILED", humanSummary: "Handlingen kunne ikke valideres." };
  }

  const commandWorkspaceId = readWorkspaceId(parsed.data);
  if (commandWorkspaceId !== undefined && commandWorkspaceId !== args.principal.workspaceId) {
    return { status: "DENIED", humanSummary: "Objektet tilhører ikke det aktive workspace." };
  }

  const now = args.now ?? new Date();
  const ctx: ActionContext<Input> = {
    principal: args.principal,
    input: parsed.data,
    now
  };

  if (args.definition.authorize && !(await args.definition.authorize(ctx))) {
    return { status: "DENIED", humanSummary: "Du har ikke adgang til objektet." };
  }

  const risk = args.definition.risk(ctx);
  const decision = evaluateActionPolicy({
    principal: args.principal,
    requiredCapabilities: args.definition.requiredCapabilities,
    risk,
    explicitlyDelegated: args.explicitlyDelegated,
    reversible: args.definition.reversible,
    externalCommunication: args.definition.externalCommunication
  });

  const id = intentId(args.principal.requestId, args.definition.id);
  const summary = args.definition.preview ? await args.definition.preview(ctx) : args.definition.id;
  const parametersDigest = digestParameters(parsed.data);

  await args.store.createIntent({
    id,
    workspaceId: args.principal.workspaceId,
    actionId: args.definition.id,
    requestedByPrincipalId: args.principal.principalId,
    requestedByPrincipalType: args.principal.principalType,
    parameters: parsed.data,
    parametersDigest,
    humanSummary: summary,
    riskLevel: risk,
    policyDecision: decision.type,
    state: decision.type === "REVIEW_REQUIRED" ? "WAITING_APPROVAL" : decision.type === "DENY" ? "FAILED" : "PENDING",
    createdAt: now.toISOString()
  });

  if (decision.type === "DENY") {
    await args.store.appendAudit({
      workspaceId: args.principal.workspaceId,
      actorId: args.principal.principalId,
      actionId: args.definition.id,
      intentId: id,
      outcome: "DENIED",
      occurredAt: now.toISOString()
    });
    return { status: "DENIED", humanSummary: decision.reason, actionId: id };
  }

  if (decision.type === "REVIEW_REQUIRED") {
    const approvalDefinition = args.definition.approval;
    const approvalId = `approval:${id}`;
    const targetFingerprint =
      approvalDefinition?.targetFingerprint?.(ctx) ??
      fingerprintTarget({
        workspaceId: args.principal.workspaceId,
        actionId: args.definition.id,
        targetType: "ACTION_INTENT",
        targetId: id
      });

    const approval = createBoundApproval({
      id: approvalId,
      workspaceId: args.principal.workspaceId,
      actionIntentId: id,
      requestedByPrincipal: args.principal,
      requiredApproverScope: approvalDefinition?.requiredApproverScope ?? "OWNER",
      humanSummary: summary,
      consequenceSummary:
        approvalDefinition?.consequenceSummary(ctx) ??
        "Handlingen har en konsekvens, der kræver menneskelig godkendelse.",
      reversibility: approvalDefinition?.reversibility ?? "PARTIALLY_REVERSIBLE",
      targetFingerprint,
      parameters: parsed.data,
      createdAt: now,
      expiresAt: new Date(now.getTime() + (approvalDefinition?.expiresInMs ?? 15 * 60 * 1000))
    });

    await args.store.createApproval(approval);
    await args.store.appendAudit({
      workspaceId: args.principal.workspaceId,
      actorId: args.principal.principalId,
      actionId: args.definition.id,
      intentId: id,
      approvalId,
      outcome: "PENDING_APPROVAL",
      occurredAt: now.toISOString()
    });

    return {
      status: "PENDING_APPROVAL",
      humanSummary: summary,
      actionId: id,
      approvalId
    };
  }

  try {
    const result = await args.definition.execute(ctx);
    await args.store.appendAudit({
      workspaceId: args.principal.workspaceId,
      actorId: args.principal.principalId,
      actionId: args.definition.id,
      intentId: id,
      outcome: "SUCCEEDED",
      occurredAt: now.toISOString()
    });
    return { status: "SUCCEEDED", humanSummary: summary, actionId: id, data: result };
  } catch {
    await args.store.appendAudit({
      workspaceId: args.principal.workspaceId,
      actorId: args.principal.principalId,
      actionId: args.definition.id,
      intentId: id,
      outcome: "FAILED",
      occurredAt: now.toISOString()
    });
    return {
      status: "FAILED",
      humanSummary: "Handlingen kunne ikke gennemføres.",
      actionId: id,
      recovery: { label: "Prøv igen", action: args.definition.id }
    };
  }
}
