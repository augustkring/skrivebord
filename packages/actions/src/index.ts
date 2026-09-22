import type { PolicyDecision, PrincipalContext, RiskLevel, ToolResult } from "@skrivebord/contracts";
import { evaluateActionPolicy } from "@skrivebord/policy";
import type { z } from "zod";

export type ActionContext<Input> = { principal: PrincipalContext; input: Input; now: Date };
export type ActionDefinition<Input, Result> = {
  id: string;
  input: z.ZodType<Input>;
  requiredCapabilities: string[];
  risk: (ctx: ActionContext<Input>) => RiskLevel;
  authorize?: (ctx: ActionContext<Input>) => Promise<boolean>;
  preview?: (ctx: ActionContext<Input>) => Promise<string>;
  execute: (ctx: ActionContext<Input>) => Promise<Result>;
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
  humanSummary: string;
  riskLevel: RiskLevel;
  policyDecision: PolicyDecision["type"];
  state: "PENDING" | "WAITING_APPROVAL" | "SUCCEEDED" | "FAILED";
  createdAt: string;
};

export interface ActionStore {
  createIntent(intent: ActionIntentRecord): Promise<void>;
  appendAudit(event: {
    workspaceId: string;
    actorId: string;
    actionId: string;
    intentId: string;
    outcome: string;
    occurredAt: string;
  }): Promise<void>;
}

export class InMemoryActionStore implements ActionStore {
  intents: ActionIntentRecord[] = [];
  audit: Array<{ workspaceId: string; actorId: string; actionId: string; intentId: string; outcome: string; occurredAt: string }> = [];

  async createIntent(intent: ActionIntentRecord) {
    this.intents.push(intent);
  }

  async appendAudit(event: { workspaceId: string; actorId: string; actionId: string; intentId: string; outcome: string; occurredAt: string }) {
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
  if (!parsed.success) return { status: "FAILED", humanSummary: "Handlingen kunne ikke valideres." };

  const commandWorkspaceId = readWorkspaceId(parsed.data);
  if (commandWorkspaceId !== undefined && commandWorkspaceId !== args.principal.workspaceId) {
    return { status: "DENIED", humanSummary: "Objektet tilhører ikke det aktive workspace." };
  }

  const now = args.now ?? new Date();
  const ctx = { principal: args.principal, input: parsed.data, now };

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

  await args.store.createIntent({
    id,
    workspaceId: args.principal.workspaceId,
    actionId: args.definition.id,
    requestedByPrincipalId: args.principal.principalId,
    requestedByPrincipalType: args.principal.principalType,
    parameters: parsed.data,
    humanSummary: summary,
    riskLevel: risk,
    policyDecision: decision.type,
    state: decision.type === "REVIEW_REQUIRED" ? "WAITING_APPROVAL" : "PENDING",
    createdAt: now.toISOString()
  });

  if (decision.type === "DENY") {
    await args.store.appendAudit({ workspaceId: args.principal.workspaceId, actorId: args.principal.principalId, actionId: args.definition.id, intentId: id, outcome: "DENIED", occurredAt: now.toISOString() });
    return { status: "DENIED", humanSummary: decision.reason, actionId: id };
  }

  if (decision.type === "REVIEW_REQUIRED") {
    await args.store.appendAudit({ workspaceId: args.principal.workspaceId, actorId: args.principal.principalId, actionId: args.definition.id, intentId: id, outcome: "PENDING_APPROVAL", occurredAt: now.toISOString() });
    return { status: "PENDING_APPROVAL", humanSummary: summary, actionId: id, approvalId: `approval:${id}` };
  }

  try {
    const result = await args.definition.execute(ctx);
    await args.store.appendAudit({ workspaceId: args.principal.workspaceId, actorId: args.principal.principalId, actionId: args.definition.id, intentId: id, outcome: "SUCCEEDED", occurredAt: now.toISOString() });
    return { status: "SUCCEEDED", humanSummary: summary, actionId: id, data: result };
  } catch {
    await args.store.appendAudit({ workspaceId: args.principal.workspaceId, actorId: args.principal.principalId, actionId: args.definition.id, intentId: id, outcome: "FAILED", occurredAt: now.toISOString() });
    return { status: "FAILED", humanSummary: "Handlingen kunne ikke gennemføres.", actionId: id, recovery: { label: "Prøv igen", action: args.definition.id } };
  }
}
