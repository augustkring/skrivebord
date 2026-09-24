import {
  executeAction
} from "@skrivebord/actions";
import {
  getActionStatus,
  persistCalendarWriteResult,
  TransactionalPostgresActionStore,
  withPrincipalTransaction
} from "@skrivebord/database";
import { z } from "zod";
import {
  createMoveCalendarEventAction
} from "@/lib/calendar-actions";
import {
  calendarMoveFailurePresentation
} from "@/lib/calendar-move";
import { databasePool } from "@/lib/database";
import {
  resolveWorkspaceHumanPrincipal
} from "@/lib/principal";
import {
  runGoogleCalendarSync
} from "@/lib/google-sync";
import {
  runMicrosoftCalendarSync
} from "@/lib/microsoft-sync";

const RequestSchema = z.object({
  workspaceSlug:
    z.string().min(1),
  eventId:
    z.string().uuid(),
  startsAt:
    z.string().datetime({
      offset: true
    }),
  endsAt:
    z.string().datetime({
      offset: true
    }),
  scope:
    z.enum([
      "OCCURRENCE",
      "SERIES"
    ]),
  idempotencyKey:
    z.string().uuid()
}).strict();

export async function POST(
  request: Request
) {
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
          "Kalenderændringen kunne ikke valideres."
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

  if (!principal) {
    return Response.json(
      {
        status: "DENIED",
        humanSummary:
          "Du har ikke adgang til dette workspace."
      },
      { status: 401 }
    );
  }

  const store =
    new TransactionalPostgresActionStore(
      databasePool,
      principal
    );

  const result =
    await executeAction({
      definition:
        createMoveCalendarEventAction(),
      principal,
      rawInput: {
        workspaceId:
          principal.workspaceId,
        eventId:
          parsed.data.eventId,
        startsAt:
          parsed.data.startsAt,
        endsAt:
          parsed.data.endsAt,
        scope:
          parsed.data.scope
      },
      idempotencyKey:
        parsed.data.idempotencyKey,
      store
    });

  if (
    result.status ===
      "SUCCEEDED" &&
    result.data
  ) {
    try {
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
        if (
          result.data.provider ===
          "GOOGLE"
        ) {
          await runGoogleCalendarSync({
            workspaceId:
              principal.workspaceId,
            sourceIds: [
              result.data
                .calendarSourceId
            ]
          });
        } else {
          await runMicrosoftCalendarSync({
            workspaceId:
              principal.workspaceId,
            sourceIds: [
              result.data
                .calendarSourceId
            ]
          });
        }
      } catch {
        return Response.json(
          {
            ...result,
            humanSummary:
              "Begivenheden blev ændret hos kalenderudbyderen. Den lokale kalender afventer ny synkronisering.",
            recovery: {
              label:
                "Synkronisér kalender",
              action:
                result.data.provider ===
                "GOOGLE"
                  ? "connection.google.sync"
                  : "connection.microsoft.sync"
            }
          },
          { status: 200 }
        );
      }
    }
  }

  if (
    result.status === "FAILED" &&
    result.actionId
  ) {
    const state =
      await withPrincipalTransaction(
        databasePool,
        principal,
        ({ db }) =>
          getActionStatus(
            db,
            {
              workspaceId:
                principal.workspaceId,
              actionIntentId:
                result.actionId!
            }
          )
      );

    const presentation =
      calendarMoveFailurePresentation(
        state?.execution
          ?.errorCode ??
          undefined,
        state?.execution
          ?.retryable ??
          false
      );

    return Response.json(
      {
        ...result,
        humanSummary:
          presentation
            .humanSummary,
        ...(presentation.recovery
          ? {
              recovery:
                presentation.recovery
            }
          : {})
      },
      {
        status:
          state?.execution
            ?.errorCode ===
          "CALENDAR_PROVIDER_CONFLICT"
            ? 409
            : 502
      }
    );
  }

  const statusCode =
    result.status === "SUCCEEDED"
      ? 200
      : result.status ===
          "PENDING_APPROVAL"
        ? 202
        : result.status ===
            "DENIED"
          ? 403
          : result.status ===
              "CONFLICT"
            ? 409
            : 500;

  return Response.json(
    result,
    { status: statusCode }
  );
}
