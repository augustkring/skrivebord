import {
  executeAction
} from "@skrivebord/actions";
import {
  persistCalendarWriteResult,
  TransactionalPostgresActionStore,
  withPrincipalTransaction
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
        createMoveGoogleCalendarEventAction(),
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
        await runGoogleCalendarSync({
          workspaceId:
            principal.workspaceId,
          sourceIds: [
            result.data
              .calendarSourceId
          ]
        });
      } catch {
        return Response.json(
          {
            ...result,
            humanSummary:
              "Begivenheden blev ændret hos Google. Den lokale kalender afventer ny synkronisering.",
            recovery: {
              label:
                "Synkronisér kalender",
              action:
                "connection.google.sync"
            }
          },
          { status: 200 }
        );
      }
    }
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
