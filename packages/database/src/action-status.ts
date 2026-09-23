import {
  and,
  eq
} from "drizzle-orm";
import type {
  SkrivebordDatabase
} from "./client";
import {
  actionExecution,
  actionIntent,
  approvalRequest
} from "./schema";

export async function getActionStatus(
  db: SkrivebordDatabase,
  input: {
    workspaceId: string;
    actionIntentId: string;
    requestedByPrincipalId?: string;
  }
) {
  const [intent] = await db
    .select({
      id: actionIntent.id,
      actionId:
        actionIntent.actionId,
      state:
        actionIntent.state,
      humanSummary:
        actionIntent.humanSummary,
      requestedByPrincipalId:
        actionIntent
          .requestedByPrincipalId,
      approvedAt:
        actionIntent.approvedAt,
      approvedByPrincipalId:
        actionIntent
          .approvedByPrincipalId
    })
    .from(actionIntent)
    .where(
      and(
        eq(
          actionIntent.workspaceId,
          input.workspaceId
        ),
        eq(
          actionIntent.id,
          input.actionIntentId
        ),
        ...(input
          .requestedByPrincipalId
          ? [
              eq(
                actionIntent
                  .requestedByPrincipalId,
                input
                  .requestedByPrincipalId
              )
            ]
          : [])
      )
    )
    .limit(1);

  if (!intent) {
    return undefined;
  }

  const [execution, approval] =
    await Promise.all([
      db
        .select({
          id:
            actionExecution.id,
          state:
            actionExecution.state,
          attemptCount:
            actionExecution
              .attemptCount,
          errorCode:
            actionExecution
              .errorCode,
          failureSummary:
            actionExecution
              .failureSummary,
          retryable:
            actionExecution.retryable,
          externalEffectRefs:
            actionExecution
              .externalEffectRefs,
          startedAt:
            actionExecution.startedAt,
          completedAt:
            actionExecution
              .completedAt
        })
        .from(actionExecution)
        .where(
          and(
            eq(
              actionExecution
                .workspaceId,
              input.workspaceId
            ),
            eq(
              actionExecution
                .actionIntentId,
              intent.id
            )
          )
        )
        .limit(1)
        .then(
          (rows) => rows[0]
        ),
      db
        .select({
          id:
            approvalRequest.id,
          state:
            approvalRequest.state,
          expiresAt:
            approvalRequest.expiresAt,
          resolvedAt:
            approvalRequest.resolvedAt,
          decision:
            approvalRequest.decision
        })
        .from(approvalRequest)
        .where(
          and(
            eq(
              approvalRequest
                .workspaceId,
              input.workspaceId
            ),
            eq(
              approvalRequest
                .actionIntentId,
              intent.id
            )
          )
        )
        .limit(1)
        .then(
          (rows) => rows[0]
        )
    ]);

  return {
    ...intent,
    execution,
    approval
  };
}
