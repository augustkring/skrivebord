import {
  consumeApproval,
  executeAction,
  resolveApproval
} from "@skrivebord/actions";
import {
  getApprovalIntent,
  persistCalendarWriteResult,
  TransactionalPostgresActionStore
} from "@skrivebord/database";
import { z } from "zod";
import {
  createMoveGoogleCalendarEventAction
} from "@/lib/google-calendar-actions";
import { databasePool } from "@/lib/database";
import {
  resolveWorkspaceHumanPrincipal
} from "@/lib/principal";
import {
  runGoogleCalendarSync
} from "@/lib/google-sync";

const RequestSchema = z.object({
  workspaceSlug:
    z.string().min(1),
  decision:
    z.enum([
      "APPROVE",
      "REJECT"
    ])
}).strict();

export async function POST(
  request: Request,
  context: {
    params: Promise<{
      approvalId: string;
    }>;
  }
) {
  const { approvalId } =
    await context.params;

  if (
    !z.string()
      .uuid()
      .safeParse(
        approvalId
      ).success
  ) {
    return Response.json(
      {
        status: "FAILED",
        humanSummary:
          "Godkendelsen kunne ikke valideres."
      },
      { status: 400 }
    );
  }

  const body =
    await request.json().catch(
      () => null
    );
  const parsed =
    RequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      {
        status: "FAILED",
        humanSummary:
          "Beslutningen kunne ikke valideres."
      },
      { status: 400 }
    );
  }

  const principal =
    await resolveWorkspaceHumanPrincipal({
      workspaceSlug:
        parsed.data.workspaceSlug,
      requestId:
        crypto.randomUUID()
    });

  if (
    !principal ||
    !principal.capabilities.includes(
      "approval.resolve"
    )
  ) {
    return Response.json(
      {
        status: "DENIED",
        humanSummary:
          "Du har ikke adgang til at afgøre denne godkendelse."
      },
      { status: 403 }
    );
  }

  const store =
    new TransactionalPostgresActionStore(
      databasePool,
      principal
    );

  const approvalIntent =
    await store.runRead?.(
      undefined as never
    );

  void approvalIntent;

  const intent =
    await (async () => {
      const {
        withPrincipalTransaction
      } = await import(
        "@skrivebord/database"
      );

      return withPrincipalTransaction(
        databasePool,
        principal,
        ({ db }) =>
          getApprovalIntent(
            db,
            {
              workspaceId:
                principal.workspaceId,
              approvalId
            }
          )
      );
    })();

  if (!intent) {
    return Response.json(
      {
        status: "NOT_FOUND",
        humanSummary:
          "Godkendelsen blev ikke fundet."
      },
      { status: 404 }
    );
  }

  if (
    intent.actionId !==
    "calendar.move"
  ) {
    return Response.json(
      {
        status: "FAILED",
        humanSummary:
          "Denne handlingstype kan endnu ikke afgøres her."
      },
      { status: 409 }
    );
  }

  const resolved =
    await resolveApproval({
      store,
      approvalId,
      principal,
      decision:
        parsed.data.decision,
      currentParameters:
        intent.parameters,
      currentTargetFingerprint:
        intent.targetFingerprint
    });

  if (
    resolved.status ===
    "REJECTED"
  ) {
    await store.updateIntentState(
      intent.actionIntentId,
      "CANCELLED"
    );

    return Response.json({
      status: "REJECTED",
      humanSummary:
        "Handlingen blev afvist."
    });
  }

  if (
    resolved.status !==
    "APPROVED"
  ) {
    return Response.json(
      {
        status:
          resolved.status,
        humanSummary:
          resolved.status ===
          "SUPERSEDED"
            ? "Handlingen har ændret sig og kræver en ny godkendelse."
            : resolved.status ===
                "EXPIRED"
              ? "Godkendelsen er udløbet."
              : resolved.status ===
                  "ALREADY_RESOLVED"
                ? "Godkendelsen er allerede afgjort."
                : resolved.status ===
                    "DENIED"
                  ? resolved.reason
                  : "Godkendelsen blev ikke fundet."
      },
      {
        status:
          resolved.status ===
          "DENIED"
            ? 403
            : resolved.status ===
                "NOT_FOUND"
              ? 404
              : 409
      }
    );
  }

  const result =
    await executeAction({
      definition:
        createMoveGoogleCalendarEventAction(),
      principal,
      rawInput:
        intent.parameters,
      idempotencyKey:
        `approval:${approvalId}`,
      approvalId,
      store
    });

  if (
    result.status ===
      "SUCCEEDED" &&
    result.data
  ) {
    try {
      const {
        withPrincipalTransaction
      } = await import(
        "@skrivebord/database"
      );

      await withPrincipalTransaction(
        databasePool,
        principal,
        ({ db }) =>
          persistCalendarWriteResult(
            db,
            {
              workspaceId:
                principal.workspaceId,
              localTargetEventId:
                result.data!
                  .localTargetEventId,
              providerResult:
                result.data!
                  .providerResult
            }
          )
      );
    } catch {
      try {
        await runGoogleCalendarSync({
          workspaceId:
            principal.workspaceId,
          sourceIds: [
            result.data
              .calendarSourceId
          ]
        });
      } catch {
        // Provider success is authoritative.
        // The calendar UI can show stale sync state until reconciliation succeeds.
      }
    }

    await consumeApproval({
      store,
      approvalId,
      currentParameters:
        intent.parameters,
      currentTargetFingerprint:
        intent.targetFingerprint
    });

    await store.updateIntentState(
      intent.actionIntentId,
      "SUCCEEDED"
    );

    return Response.json({
      ...result,
      approvalId
    });
  }

  await store.updateIntentState(
    intent.actionIntentId,
    "FAILED"
  );

  return Response.json(
    {
      ...result,
      approvalId
    },
    {
      status:
        result.status ===
        "CONFLICT"
          ? 409
          : 502
    }
  );
}
