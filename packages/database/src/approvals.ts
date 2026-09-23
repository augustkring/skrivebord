import {
  and,
  desc,
  eq
} from "drizzle-orm";
import type {
  SkrivebordDatabase
} from "./client";
import {
  actionIntent,
  approvalRequest
} from "./schema";

export async function listPendingApprovals(
  db: SkrivebordDatabase,
  workspaceId: string
) {
  return db
    .select({
      id: approvalRequest.id,
      actionIntentId:
        approvalRequest.actionIntentId,
      requestedByPrincipalId:
        approvalRequest
          .requestedByPrincipalId,
      requestedByPrincipalType:
        approvalRequest
          .requestedByPrincipalType,
      requiredApproverScope:
        approvalRequest
          .requiredApproverScope,
      humanSummary:
        approvalRequest.humanSummary,
      consequenceSummary:
        approvalRequest
          .consequenceSummary,
      reversibility:
        approvalRequest.reversibility,
      targetFingerprint:
        approvalRequest
          .targetFingerprint,
      parametersDigest:
        approvalRequest
          .parametersDigest,
      state:
        approvalRequest.state,
      createdAt:
        approvalRequest.createdAt,
      expiresAt:
        approvalRequest.expiresAt,
      actionId:
        actionIntent.actionId,
      parameters:
        actionIntent.parameters,
      riskLevel:
        actionIntent.riskLevel
    })
    .from(approvalRequest)
    .innerJoin(
      actionIntent,
      and(
        eq(
          approvalRequest
            .actionIntentId,
          actionIntent.id
        ),
        eq(
          approvalRequest
            .workspaceId,
          actionIntent.workspaceId
        )
      )
    )
    .where(
      and(
        eq(
          approvalRequest.workspaceId,
          workspaceId
        ),
        eq(
          approvalRequest.state,
          "PENDING"
        )
      )
    )
    .orderBy(
      desc(
        approvalRequest.createdAt
      )
    );
}

export async function getApprovalIntent(
  db: SkrivebordDatabase,
  input: {
    workspaceId: string;
    approvalId: string;
  }
) {
  const [row] = await db
    .select({
      approvalId:
        approvalRequest.id,
      actionIntentId:
        approvalRequest.actionIntentId,
      approvalState:
        approvalRequest.state,
      targetFingerprint:
        approvalRequest
          .targetFingerprint,
      actionId:
        actionIntent.actionId,
      parameters:
        actionIntent.parameters,
      intentState:
        actionIntent.state,
      idempotencyKey:
        actionIntent.idempotencyKey,
      approvedAt:
        actionIntent.approvedAt,
      approvedByPrincipalId:
        actionIntent.approvedByPrincipalId
    })
    .from(approvalRequest)
    .innerJoin(
      actionIntent,
      and(
        eq(
          approvalRequest
            .actionIntentId,
          actionIntent.id
        ),
        eq(
          approvalRequest
            .workspaceId,
          actionIntent.workspaceId
        )
      )
    )
    .where(
      and(
        eq(
          approvalRequest.workspaceId,
          input.workspaceId
        ),
        eq(
          approvalRequest.id,
          input.approvalId
        )
      )
    )
    .limit(1);

  return row;
}


export async function getPendingApprovalByIntent(
  db: SkrivebordDatabase,
  input: {
    workspaceId: string;
    actionIntentId: string;
  }
) {
  const [row] = await db
    .select({
      id: approvalRequest.id,
      actionIntentId:
        approvalRequest.actionIntentId,
      state:
        approvalRequest.state
    })
    .from(approvalRequest)
    .where(
      and(
        eq(
          approvalRequest.workspaceId,
          input.workspaceId
        ),
        eq(
          approvalRequest.actionIntentId,
          input.actionIntentId
        ),
        eq(
          approvalRequest.state,
          "PENDING"
        )
      )
    )
    .orderBy(
      desc(
        approvalRequest.createdAt
      )
    )
    .limit(1);

  return row;
}


export async function markActionIntentApproved(
  db: SkrivebordDatabase,
  input: {
    workspaceId: string;
    actionIntentId: string;
    approvedByPrincipalId: string;
    approvedAt?: Date;
  }
): Promise<void> {
  const rows = await db
    .update(actionIntent)
    .set({
      approvedAt:
        input.approvedAt ??
        new Date(),
      approvedByPrincipalId:
        input.approvedByPrincipalId
    })
    .where(
      and(
        eq(
          actionIntent.workspaceId,
          input.workspaceId
        ),
        eq(
          actionIntent.id,
          input.actionIntentId
        )
      )
    )
    .returning({
      id: actionIntent.id
    });

  if (rows.length !== 1) {
    throw new Error(
      "ACTION_INTENT_NOT_FOUND"
    );
  }
}
