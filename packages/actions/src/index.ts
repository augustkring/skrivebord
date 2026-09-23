import type {
  PolicyDecision,
  PrincipalContext,
  RiskLevel,
  ToolResult
} from "@skrivebord/contracts";
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
  idempotency?: "OPTIONAL" | "REQUIRED";
  externalEffectRefs?: (
    result: Result,
    ctx: ActionContext<Input>
  ) => string[];
  classifyFailure?: (
    error: unknown,
    ctx: ActionContext<Input>
  ) => {
    code?: string;
    summary?: string;
    retryable: boolean;
  };
};

export type ActionIntentState =
  | "PENDING"
  | "WAITING_APPROVAL"
  | "QUEUED"
  | "RUNNING"
  | "SUCCEEDED"
  | "PARTIAL"
  | "FAILED"
  | "CANCELLED"
  | "ROLLED_BACK";

export type ActionIntentRecord = {
  id: string;
  workspaceId: string;
  actionId: string;
  idempotencyKey?: string;
  requestedByPrincipalId: string;
  requestedByPrincipalType: PrincipalContext["principalType"];
  parameters: unknown;
  parametersDigest: string;
  humanSummary: string;
  riskLevel: RiskLevel;
  policyDecision: PolicyDecision["type"];
  state: ActionIntentState;
  createdAt: string;
};

export type ActionExecutionState =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED";

export type ActionExecutionRecord = {
  id: string;
  workspaceId: string;
  actionIntentId: string;
  idempotencyKey: string;
  parametersDigest: string;
  state: ActionExecutionState;
  createdAt: string;
};

export type ActionExecutionClaim =
  | {
      type: "CLAIMED";
      executionId: string;
    }
  | {
      type: "REPLAY";
      executionId: string;
      result: unknown;
      externalEffectRefs: string[];
    }
  | {
      type: "KEY_REUSED";
      executionId: string;
    }
  | {
      type: "IN_PROGRESS";
      executionId: string;
    }
  | {
      type: "FAILED";
      executionId: string;
      errorCode?: string;
      retryable: false;
    };

export type AuditWrite = {
  workspaceId: string;
  actorId: string;
  actorType: PrincipalContext["principalType"];
  actionId: string;
  intentId: string;
  approvalId?: string;
  requestId: string;
  source: PrincipalContext["source"];
  outcome: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
};

export type ActionIntentClaim =
  | {
      type: "CLAIMED";
      intentId: string;
    }
  | {
      type: "EXISTING";
      intentId: string;
      state: ActionIntentState;
      parametersDigest: string;
    }
  | {
      type: "KEY_REUSED";
      intentId: string;
    };

export interface ActionStore extends ApprovalStore {
  createIntent(intent: ActionIntentRecord): Promise<void>;
  claimIntent(intent: ActionIntentRecord): Promise<ActionIntentClaim>;
  getPendingApprovalByIntent?(
    actionIntentId: string
  ): Promise<{ id: string } | undefined>;
  updateIntentState(intentId: string, state: ActionIntentState): Promise<void>;
  claimExecution(execution: ActionExecutionRecord): Promise<ActionExecutionClaim>;
  markExecutionRunning(executionId: string, startedAt: string): Promise<void>;
  completeExecution(input: {
    executionId: string;
    result: unknown;
    externalEffectRefs: string[];
    completedAt: string;
  }): Promise<void>;
  failExecution(input: {
    executionId: string;
    errorCode?: string;
    failureSummary?: string;
    retryable: boolean;
    failedAt: string;
  }): Promise<void>;
  appendAudit(event: AuditWrite): Promise<void>;
}

export class InMemoryActionStore implements ActionStore {
  intents: ActionIntentRecord[] = [];
  executions = new Map<string, ActionExecutionRecord & {
    result?: unknown;
    externalEffectRefs?: string[];
    errorCode?: string;
    failureSummary?: string;
    retryable?: boolean;
    attemptCount: number;
  }>();
  approvals = new Map<string, ApprovalRecord>();
  audit: AuditWrite[] = [];

  async createIntent(intent: ActionIntentRecord) {
    this.intents.push(intent);
  }

  async claimIntent(
    intent: ActionIntentRecord
  ): Promise<ActionIntentClaim> {
    if (!intent.idempotencyKey) {
      this.intents.push(intent);
      return {
        type: "CLAIMED",
        intentId: intent.id
      };
    }

    const existing =
      this.intents.find(
        (candidate) =>
          candidate.workspaceId ===
            intent.workspaceId &&
          candidate.idempotencyKey ===
            intent.idempotencyKey
      );

    if (!existing) {
      this.intents.push(intent);
      return {
        type: "CLAIMED",
        intentId: intent.id
      };
    }

    if (
      existing.parametersDigest !==
      intent.parametersDigest
    ) {
      return {
        type: "KEY_REUSED",
        intentId: existing.id
      };
    }

    return {
      type: "EXISTING",
      intentId: existing.id,
      state: existing.state,
      parametersDigest:
        existing.parametersDigest
    };
  }

  async getPendingApprovalByIntent(
    actionIntentId: string
  ): Promise<{ id: string } | undefined> {
    const approval =
      [...this.approvals.values()]
        .find(
          (candidate) =>
            candidate.actionIntentId ===
              actionIntentId &&
            candidate.state ===
              "PENDING"
        );

    return approval
      ? { id: approval.id }
      : undefined;
  }

  async updateIntentState(intentId: string, state: ActionIntentState) {
    const intent = this.intents.find((candidate) => candidate.id === intentId);
    if (!intent) throw new Error("ACTION_INTENT_NOT_FOUND");
    intent.state = state;
  }

  async claimExecution(
    execution: ActionExecutionRecord
  ): Promise<ActionExecutionClaim> {
    const existing = [...this.executions.values()].find(
      (candidate) =>
        candidate.workspaceId === execution.workspaceId &&
        candidate.idempotencyKey === execution.idempotencyKey
    );

    if (!existing) {
      this.executions.set(execution.id, {
        ...execution,
        attemptCount: 1
      });
      return {
        type: "CLAIMED",
        executionId: execution.id
      };
    }

    if (
      existing.parametersDigest !==
      execution.parametersDigest
    ) {
      return {
        type: "KEY_REUSED",
        executionId: existing.id
      };
    }

    if (existing.state === "SUCCEEDED") {
      return {
        type: "REPLAY",
        executionId: existing.id,
        result: existing.result,
        externalEffectRefs:
          existing.externalEffectRefs ?? []
      };
    }

    if (existing.state === "FAILED") {
      if (existing.retryable) {
        existing.state = "PENDING";
        existing.attemptCount += 1;
        existing.errorCode = undefined;
        existing.failureSummary = undefined;
        existing.retryable = false;

        return {
          type: "CLAIMED",
          executionId: existing.id
        };
      }

      return {
        type: "FAILED",
        executionId: existing.id,
        errorCode: existing.errorCode,
        retryable: false
      };
    }

    return {
      type: "IN_PROGRESS",
      executionId: existing.id
    };
  }

  async markExecutionRunning(
    executionId: string,
    startedAt: string
  ) {
    void startedAt;
    const execution = this.executions.get(executionId);
    if (!execution) throw new Error("ACTION_EXECUTION_NOT_FOUND");
    execution.state = "RUNNING";
  }

  async completeExecution(input: {
    executionId: string;
    result: unknown;
    externalEffectRefs: string[];
    completedAt: string;
  }) {
    const execution = this.executions.get(input.executionId);
    if (!execution) throw new Error("ACTION_EXECUTION_NOT_FOUND");
    execution.state = "SUCCEEDED";
    execution.result = input.result;
    execution.externalEffectRefs = input.externalEffectRefs;
  }

  async failExecution(input: {
    executionId: string;
    errorCode?: string;
    failureSummary?: string;
    retryable: boolean;
    failedAt: string;
  }) {
    void input.failedAt;
    const execution = this.executions.get(input.executionId);
    if (!execution) throw new Error("ACTION_EXECUTION_NOT_FOUND");
    execution.state = "FAILED";
    execution.errorCode = input.errorCode;
    execution.failureSummary = input.failureSummary;
    execution.retryable = input.retryable;
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

  async appendAudit(event: AuditWrite) {
    this.audit.push(event);
  }
}

function newId(): string {
  return crypto.randomUUID();
}

function readWorkspaceId(value: unknown): string | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !("workspaceId" in value)
  ) {
    return undefined;
  }

  const workspaceId = (value as { workspaceId?: unknown }).workspaceId;
  return typeof workspaceId === "string" ? workspaceId : undefined;
}

function auditBase(
  principal: PrincipalContext,
  actionId: string,
  intentId: string,
  occurredAt: string
): Omit<AuditWrite, "outcome" | "approvalId"> {
  return {
    workspaceId: principal.workspaceId,
    actorId: principal.principalId,
    actorType: principal.principalType,
    actionId,
    intentId,
    requestId: principal.requestId,
    source: principal.source,
    occurredAt
  };
}

export async function executeAction<Input, Result>(args: {
  definition: ActionDefinition<Input, Result>;
  principal: PrincipalContext;
  rawInput: unknown;
  store: ActionStore;
  now?: Date;
  explicitlyDelegated?: boolean;
  idempotencyKey?: string;
  approvalId?: string;
}): Promise<ToolResult<Result>> {
  const parsed = args.definition.input.safeParse(args.rawInput);
  if (!parsed.success) {
    return {
      status: "FAILED",
      humanSummary: "Handlingen kunne ikke valideres."
    };
  }

  const commandWorkspaceId = readWorkspaceId(parsed.data);
  if (
    commandWorkspaceId !== undefined &&
    commandWorkspaceId !== args.principal.workspaceId
  ) {
    return {
      status: "DENIED",
      humanSummary: "Objektet tilhører ikke det aktive workspace."
    };
  }

  const now = args.now ?? new Date();
  const ctx: ActionContext<Input> = {
    principal: args.principal,
    input: parsed.data,
    now
  };

  if (
    args.definition.authorize &&
    !(await args.definition.authorize(ctx))
  ) {
    return {
      status: "DENIED",
      humanSummary: "Du har ikke adgang til objektet."
    };
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

  let id = newId();
  const summary = args.definition.preview
    ? await args.definition.preview(ctx)
    : args.definition.id;
  const parametersDigest = digestParameters(parsed.data);
  const intentIdempotencyKey =
    args.idempotencyKey?.trim();

  const intent: ActionIntentRecord = {
    id,
    workspaceId: args.principal.workspaceId,
    actionId: args.definition.id,
    ...(intentIdempotencyKey
      ? {
          idempotencyKey:
            intentIdempotencyKey
        }
      : {}),
    requestedByPrincipalId: args.principal.principalId,
    requestedByPrincipalType: args.principal.principalType,
    parameters: parsed.data,
    parametersDigest,
    humanSummary: summary,
    riskLevel: risk,
    policyDecision: decision.type,
    state:
      decision.type === "REVIEW_REQUIRED"
        ? "WAITING_APPROVAL"
        : decision.type === "DENY"
          ? "FAILED"
          : "PENDING",
    createdAt: now.toISOString()
  };

  if (intentIdempotencyKey) {
    const intentClaim =
      await args.store.claimIntent(
        intent
      );

    id = intentClaim.intentId;

    if (
      intentClaim.type ===
      "KEY_REUSED"
    ) {
      return {
        status: "CONFLICT",
        humanSummary:
          "Idempotency-keyen er allerede brugt til en anden handling.",
        actionId: id
      };
    }

    if (
      intentClaim.type ===
      "EXISTING"
    ) {
      if (
        intentClaim.state ===
        "WAITING_APPROVAL"
      ) {
        const approval =
          await args.store.getPendingApprovalByIntent?.(
            id
          );

        return {
          status:
            "PENDING_APPROVAL",
          humanSummary: summary,
          actionId: id,
          ...(approval
            ? {
                approvalId:
                  approval.id
              }
            : {})
        };
      }

      if (
        intentClaim.state ===
        "SUCCEEDED"
      ) {
        const existingExecution =
          await args.store
            .claimExecution({
              id: newId(),
              workspaceId:
                args.principal.workspaceId,
              actionIntentId: id,
              idempotencyKey:
                intentIdempotencyKey,
              parametersDigest,
              state: "PENDING",
              createdAt:
                now.toISOString()
            });

        if (
          existingExecution.type ===
          "REPLAY"
        ) {
          return {
            status: "SUCCEEDED",
            humanSummary: summary,
            actionId: id,
            executionId:
              existingExecution.executionId,
            data:
              existingExecution.result as Result
          };
        }
      }

      return {
        status: "CONFLICT",
        humanSummary:
          "Den samme handling er allerede registreret.",
        actionId: id,
        recovery: {
          label:
            "Kontrollér status",
          action:
            "actions.get_status"
        }
      };
    }
  } else {
    await args.store.createIntent(
      intent
    );
  }

  const baseAudit = {
    ...auditBase(
      args.principal,
      args.definition.id,
      id,
      now.toISOString()
    ),
    ...(args.approvalId
      ? {
          approvalId:
            args.approvalId
        }
      : {})
  };

  if (decision.type === "DENY") {
    await args.store.appendAudit({
      ...baseAudit,
      outcome: "DENIED"
    });

    return {
      status: "DENIED",
      humanSummary: decision.reason,
      actionId: id
    };
  }

  if (decision.type === "REVIEW_REQUIRED") {
    const approvalDefinition = args.definition.approval;
    const approvalId = newId();
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
      requiredApproverScope:
        approvalDefinition?.requiredApproverScope ?? "OWNER",
      humanSummary: summary,
      consequenceSummary:
        approvalDefinition?.consequenceSummary(ctx) ??
        "Handlingen har en konsekvens, der kræver menneskelig godkendelse.",
      reversibility:
        approvalDefinition?.reversibility ?? "PARTIALLY_REVERSIBLE",
      targetFingerprint,
      parameters: parsed.data,
      createdAt: now,
      expiresAt: new Date(
        now.getTime() + (approvalDefinition?.expiresInMs ?? 15 * 60 * 1000)
      )
    });

    await args.store.createApproval(approval);
    await args.store.appendAudit({
      ...baseAudit,
      approvalId,
      outcome: "PENDING_APPROVAL"
    });

    return {
      status: "PENDING_APPROVAL",
      humanSummary: summary,
      actionId: id,
      approvalId
    };
  }

  const idempotencyKey =
    args.idempotencyKey?.trim();
  const usesIdempotency =
    args.definition.idempotency === "REQUIRED" ||
    Boolean(idempotencyKey);

  let executionId: string | undefined;

  if (usesIdempotency) {
    if (
      !idempotencyKey ||
      idempotencyKey.length > 200
    ) {
      await args.store.updateIntentState(id, "FAILED");
      await args.store.appendAudit({
        ...baseAudit,
        outcome: "IDEMPOTENCY_REQUIRED"
      });

      return {
        status: "FAILED",
        humanSummary:
          "Handlingen kræver en idempotency-key.",
        actionId: id
      };
    }

    const execution = {
      id: newId(),
      workspaceId: args.principal.workspaceId,
      actionIntentId: id,
      idempotencyKey,
      parametersDigest,
      state: "PENDING" as const,
      createdAt: now.toISOString()
    };

    const claim =
      await args.store.claimExecution(
        execution
      );

    executionId = claim.executionId;

    if (claim.type === "KEY_REUSED") {
      await args.store.updateIntentState(id, "FAILED");
      await args.store.appendAudit({
        ...baseAudit,
        outcome:
          "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
        metadata: {
          executionId
        }
      });

      return {
        status: "CONFLICT",
        humanSummary:
          "Idempotency-keyen er allerede brugt til en anden handling.",
        actionId: id,
        executionId
      };
    }

    if (claim.type === "REPLAY") {
      await args.store.updateIntentState(id, "SUCCEEDED");
      await args.store.appendAudit({
        ...baseAudit,
        outcome: "REPLAYED_SUCCEEDED_EXECUTION",
        metadata: {
          executionId,
          externalEffectRefs:
            claim.externalEffectRefs
        }
      });

      return {
        status: "SUCCEEDED",
        humanSummary: summary,
        actionId: id,
        executionId,
        data: claim.result as Result
      };
    }

    if (claim.type === "IN_PROGRESS") {
      await args.store.updateIntentState(
        id,
        "CANCELLED"
      );
      await args.store.appendAudit({
        ...baseAudit,
        outcome: "IDEMPOTENT_EXECUTION_IN_PROGRESS",
        metadata: {
          executionId
        }
      });

      return {
        status: "CONFLICT",
        humanSummary:
          "Den samme handling er allerede i gang.",
        actionId: id,
        executionId,
        recovery: {
          label: "Kontrollér status",
          action: "actions.get_status"
        }
      };
    }

    if (claim.type === "FAILED") {
      await args.store.updateIntentState(id, "FAILED");
      await args.store.appendAudit({
        ...baseAudit,
        outcome: "PREVIOUS_EXECUTION_FAILED",
        metadata: {
          executionId,
          errorCode:
            claim.errorCode ?? null
        }
      });

      return {
        status: "FAILED",
        humanSummary:
          "En tidligere execution med samme idempotency-key fejlede.",
        actionId: id,
        executionId,
        recovery: {
          label: "Gennemgå fejlen",
          action: "actions.get_status"
        }
      };
    }

    await args.store.markExecutionRunning(
      executionId,
      now.toISOString()
    );
    await args.store.updateIntentState(
      id,
      "RUNNING"
    );
  }

  let result: Result;

  try {
    result =
      await args.definition.execute(ctx);
  } catch (error) {
    const failure =
      args.definition.classifyFailure?.(
        error,
        ctx
      ) ?? {
        code:
          error instanceof Error
            ? error.name ||
              "ACTION_EXECUTION_FAILED"
            : "ACTION_EXECUTION_FAILED",
        summary:
          error instanceof Error
            ? error.message.slice(0, 500)
            : undefined,
        retryable: false
      };

    if (executionId) {
      await args.store.failExecution({
        executionId,
        errorCode:
          failure.code,
        failureSummary:
          failure.summary,
        retryable:
          failure.retryable,
        failedAt:
          new Date().toISOString()
      });
    }

    await args.store.updateIntentState(id, "FAILED");
    await args.store.appendAudit({
      ...baseAudit,
      outcome: "FAILED",
      metadata: {
        ...(executionId
          ? { executionId }
          : {}),
        errorCode:
          failure.code ?? null,
        retryable:
          failure.retryable
      }
    });

    return {
      status: "FAILED",
      humanSummary:
        "Handlingen kunne ikke gennemføres.",
      actionId: id,
      executionId,
      recovery: {
        label:
          failure.retryable
            ? "Prøv igen"
            : "Gennemgå fejlen",
        action: args.definition.id
      }
    };
  }

  const externalEffectRefs =
    args.definition.externalEffectRefs?.(
      result,
      ctx
    ) ?? [];

  if (executionId) {
    try {
      await args.store.completeExecution({
        executionId,
        result,
        externalEffectRefs,
        completedAt: new Date().toISOString()
      });
    } catch {
      await args.store.appendAudit({
        ...baseAudit,
        outcome:
          "EXTERNAL_EFFECT_COMPLETED_PERSISTENCE_UNCONFIRMED",
        metadata: {
          executionId
        }
      });

      return {
        status: "FAILED",
        humanSummary:
          "Handlingen blev udført, men resultatet kunne ikke bekræftes i Skrivebord. Brug samme idempotency-key ved statuskontrol.",
        actionId: id,
        executionId,
        recovery: {
          label: "Kontrollér status",
          action: "actions.get_status"
        }
      };
    }
  }

  await args.store.updateIntentState(id, "SUCCEEDED");

  await args.store.appendAudit({
    ...baseAudit,
    outcome: "SUCCEEDED",
    metadata: {
      ...(executionId
        ? { executionId }
        : {}),
      ...(externalEffectRefs.length > 0
        ? { externalEffectRefs }
        : {})
    }
  });

  return {
    status: "SUCCEEDED",
    humanSummary: summary,
    actionId: id,
    executionId,
    data: result
  };
}
