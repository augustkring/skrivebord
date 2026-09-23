import type {
  ActionExecutionClaim,
  ActionExecutionRecord,
  ActionIntentClaim,
  ActionIntentRecord,
  ActionIntentState,
  ActionStore,
  AuditWrite,
  ApprovalRecord
} from "@skrivebord/actions";
import { and, eq, sql } from "drizzle-orm";
import type { SkrivebordDatabase } from "./client";
import {
  actionExecution,
  actionIntent,
  approvalRequest,
  auditEvent
} from "./schema";

export class PostgresActionStore implements ActionStore {
  constructor(
    private readonly db: SkrivebordDatabase,
    private readonly workspaceId: string
  ) {}

  private assertWorkspace(workspaceId: string) {
    if (workspaceId !== this.workspaceId) {
      throw new Error("ACTION_STORE_WORKSPACE_MISMATCH");
    }
  }

  async createIntent(intent: ActionIntentRecord): Promise<void> {
    this.assertWorkspace(intent.workspaceId);

    await this.db.insert(actionIntent).values({
      id: intent.id,
      workspaceId: intent.workspaceId,
      actionId: intent.actionId,
      idempotencyKey:
        intent.idempotencyKey,
      requestedByPrincipalId: intent.requestedByPrincipalId,
      requestedByPrincipalType: intent.requestedByPrincipalType,
      parameters: intent.parameters,
      parametersDigest: intent.parametersDigest,
      humanSummary: intent.humanSummary,
      riskLevel: intent.riskLevel,
      policyDecision: intent.policyDecision,
      state: intent.state,
      createdAt: new Date(intent.createdAt)
    });
  }

  async claimIntent(
    intent: ActionIntentRecord
  ): Promise<ActionIntentClaim> {
    if (!intent.idempotencyKey) {
      await this.createIntent(intent);
      return {
        type: "CLAIMED",
        intentId: intent.id
      };
    }

    const [inserted] = await this.db
      .insert(actionIntent)
      .values({
        id: intent.id,
        workspaceId:
          intent.workspaceId,
        actionId:
          intent.actionId,
        idempotencyKey:
          intent.idempotencyKey,
        requestedByPrincipalId:
          intent.requestedByPrincipalId,
        requestedByPrincipalType:
          intent.requestedByPrincipalType,
        parameters:
          intent.parameters,
        parametersDigest:
          intent.parametersDigest,
        humanSummary:
          intent.humanSummary,
        riskLevel:
          intent.riskLevel,
        policyDecision:
          intent.policyDecision,
        state:
          intent.state,
        createdAt:
          new Date(intent.createdAt)
      })
      .onConflictDoNothing({
        target: [
          actionIntent.workspaceId,
          actionIntent.idempotencyKey
        ]
      })
      .returning({
        id: actionIntent.id
      });

    if (inserted) {
      return {
        type: "CLAIMED",
        intentId: inserted.id
      };
    }

    const [existing] =
      await this.db
        .select({
          id: actionIntent.id,
          state:
            actionIntent.state,
          parametersDigest:
            actionIntent.parametersDigest
        })
        .from(actionIntent)
        .where(
          and(
            eq(
              actionIntent.workspaceId,
              intent.workspaceId
            ),
            eq(
              actionIntent.idempotencyKey,
              intent.idempotencyKey
            )
          )
        )
        .limit(1);

    if (!existing) {
      throw new Error(
        "ACTION_INTENT_CLAIM_LOST"
      );
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
      state:
        existing.state as ActionIntentState,
      parametersDigest:
        existing.parametersDigest
    };
  }

  async updateIntentState(
    intentId: string,
    state: ActionIntentState
  ): Promise<void> {
    const rows = await this.db
      .update(actionIntent)
      .set({ state })
      .where(
        and(
          eq(actionIntent.id, intentId),
          eq(actionIntent.workspaceId, this.workspaceId)
        )
      )
      .returning({ id: actionIntent.id });

    if (rows.length !== 1) {
      throw new Error("ACTION_INTENT_NOT_FOUND");
    }
  }

  async claimExecution(
    execution: ActionExecutionRecord
  ): Promise<ActionExecutionClaim> {
    const [inserted] = await this.db
      .insert(actionExecution)
      .values({
        id: execution.id,
        workspaceId: execution.workspaceId,
        actionIntentId: execution.actionIntentId,
        idempotencyKey: execution.idempotencyKey,
        parametersDigest: execution.parametersDigest,
        state: execution.state,
        createdAt: new Date(execution.createdAt)
      })
      .onConflictDoNothing({
        target: [
          actionExecution.workspaceId,
          actionExecution.idempotencyKey
        ]
      })
      .returning({
        id: actionExecution.id
      });

    if (inserted) {
      return {
        type: "CLAIMED",
        executionId: inserted.id
      };
    }

    const [existing] = await this.db
      .select()
      .from(actionExecution)
      .where(
        and(
          eq(
            actionExecution.workspaceId,
            execution.workspaceId
          ),
          eq(
            actionExecution.idempotencyKey,
            execution.idempotencyKey
          )
        )
      )
      .limit(1);

    if (!existing) {
      throw new Error(
        "ACTION_EXECUTION_CLAIM_LOST"
      );
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
          Array.isArray(
            existing.externalEffectRefs
          )
            ? existing.externalEffectRefs.filter(
                (
                  value
                ): value is string =>
                  typeof value === "string"
              )
            : []
      };
    }

    if (existing.state === "FAILED") {
      if (existing.retryable) {
        const [reclaimed] = await this.db
          .update(actionExecution)
          .set({
            state: "PENDING",
            attemptCount: sql`${actionExecution.attemptCount} + 1`,
            errorCode: null,
            failureSummary: null,
            retryable: false,
            completedAt: null,
            updatedAt: new Date(execution.createdAt)
          })
          .where(
            and(
              eq(actionExecution.id, existing.id),
              eq(
                actionExecution.workspaceId,
                execution.workspaceId
              ),
              eq(actionExecution.state, "FAILED"),
              eq(actionExecution.retryable, true)
            )
          )
          .returning({
            id: actionExecution.id
          });

        if (reclaimed) {
          return {
            type: "CLAIMED",
            executionId: reclaimed.id
          };
        }

        return {
          type: "IN_PROGRESS",
          executionId: existing.id
        };
      }

      return {
        type: "FAILED",
        executionId: existing.id,
        errorCode:
          existing.errorCode ??
          undefined,
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
  ): Promise<void> {
    const rows = await this.db
      .update(actionExecution)
      .set({
        state: "RUNNING",
        startedAt: new Date(startedAt),
        updatedAt: new Date(startedAt)
      })
      .where(
        and(
          eq(
            actionExecution.id,
            executionId
          ),
          eq(
            actionExecution.workspaceId,
            this.workspaceId
          )
        )
      )
      .returning({
        id: actionExecution.id
      });

    if (rows.length !== 1) {
      throw new Error(
        "ACTION_EXECUTION_NOT_FOUND"
      );
    }
  }

  async completeExecution(input: {
    executionId: string;
    result: unknown;
    externalEffectRefs: string[];
    completedAt: string;
  }): Promise<void> {
    const completedAt =
      new Date(input.completedAt);

    const rows = await this.db
      .update(actionExecution)
      .set({
        state: "SUCCEEDED",
        result: input.result,
        externalEffectRefs:
          input.externalEffectRefs,
        completedAt,
        updatedAt: completedAt,
        errorCode: null,
        failureSummary: null,
        retryable: false
      })
      .where(
        and(
          eq(
            actionExecution.id,
            input.executionId
          ),
          eq(
            actionExecution.workspaceId,
            this.workspaceId
          )
        )
      )
      .returning({
        id: actionExecution.id
      });

    if (rows.length !== 1) {
      throw new Error(
        "ACTION_EXECUTION_NOT_FOUND"
      );
    }
  }

  async failExecution(input: {
    executionId: string;
    errorCode?: string;
    failureSummary?: string;
    retryable: boolean;
    failedAt: string;
  }): Promise<void> {
    const failedAt =
      new Date(input.failedAt);

    const rows = await this.db
      .update(actionExecution)
      .set({
        state: "FAILED",
        errorCode:
          input.errorCode ?? null,
        failureSummary:
          input.failureSummary ?? null,
        retryable: input.retryable,
        lastErrorAt: failedAt,
        completedAt: failedAt,
        updatedAt: failedAt
      })
      .where(
        and(
          eq(
            actionExecution.id,
            input.executionId
          ),
          eq(
            actionExecution.workspaceId,
            this.workspaceId
          )
        )
      )
      .returning({
        id: actionExecution.id
      });

    if (rows.length !== 1) {
      throw new Error(
        "ACTION_EXECUTION_NOT_FOUND"
      );
    }
  }

  async createApproval(approval: ApprovalRecord): Promise<void> {
    this.assertWorkspace(approval.workspaceId);

    await this.db.insert(approvalRequest).values({
      id: approval.id,
      workspaceId: approval.workspaceId,
      actionIntentId: approval.actionIntentId,
      requestedByPrincipalId: approval.requestedByPrincipalId,
      requestedByPrincipalType: approval.requestedByPrincipalType,
      requiredApproverScope: approval.requiredApproverScope,
      humanSummary: approval.humanSummary,
      consequenceSummary: approval.consequenceSummary,
      reversibility: approval.reversibility,
      targetFingerprint: approval.targetFingerprint,
      parametersDigest: approval.parametersDigest,
      state: approval.state,
      createdAt: new Date(approval.createdAt),
      expiresAt: new Date(approval.expiresAt),
      resolvedAt: approval.resolvedAt
        ? new Date(approval.resolvedAt)
        : null,
      resolvedByPrincipalId: approval.resolvedByPrincipalId ?? null,
      decision: approval.decision ?? null
    });
  }

  async getApproval(id: string): Promise<ApprovalRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(approvalRequest)
      .where(
        and(
          eq(approvalRequest.id, id),
          eq(approvalRequest.workspaceId, this.workspaceId)
        )
      )
      .limit(1);

    if (!row) return undefined;

    return {
      id: row.id,
      workspaceId: row.workspaceId,
      actionIntentId: row.actionIntentId,
      requestedByPrincipalId: row.requestedByPrincipalId,
      requestedByPrincipalType: row.requestedByPrincipalType,
      requiredApproverScope: row.requiredApproverScope,
      humanSummary: row.humanSummary,
      consequenceSummary: row.consequenceSummary,
      reversibility: row.reversibility as ApprovalRecord["reversibility"],
      targetFingerprint: row.targetFingerprint,
      parametersDigest: row.parametersDigest,
      state: row.state,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString(),
      resolvedByPrincipalId: row.resolvedByPrincipalId ?? undefined,
      decision: (row.decision as ApprovalRecord["decision"]) ?? undefined
    };
  }

  async saveApproval(approval: ApprovalRecord): Promise<void> {
    this.assertWorkspace(approval.workspaceId);

    const rows = await this.db
      .update(approvalRequest)
      .set({
        state: approval.state,
        resolvedAt: approval.resolvedAt
          ? new Date(approval.resolvedAt)
          : null,
        resolvedByPrincipalId: approval.resolvedByPrincipalId ?? null,
        decision: approval.decision ?? null
      })
      .where(
        and(
          eq(approvalRequest.id, approval.id),
          eq(approvalRequest.workspaceId, this.workspaceId)
        )
      )
      .returning({ id: approvalRequest.id });

    if (rows.length !== 1) {
      throw new Error("APPROVAL_NOT_FOUND");
    }
  }

  async appendAudit(event: AuditWrite): Promise<void> {
    this.assertWorkspace(event.workspaceId);

    await this.db.insert(auditEvent).values({
      workspaceId: event.workspaceId,
      occurredAt: new Date(event.occurredAt),
      actorPrincipalId: event.actorId,
      actorType: event.actorType,
      action: event.actionId,
      actionIntentId: event.intentId,
      approvalId: event.approvalId,
      requestId: event.requestId,
      source: event.source,
      outcome: event.outcome,
      metadata: event.metadata ?? {}
    });
  }
}
