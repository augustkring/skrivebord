import {
  executeAction
} from "@skrivebord/actions";
import {
  persistCreatedCalendarEvent,
  TransactionalPostgresActionStore,
  withPrincipalTransaction
} from "@skrivebord/database";
import { z } from "zod";
import {
  createCalendarEventAction,
  CreateCalendarEventInputSchema
} from "@/lib/calendar-actions";
import {
  databasePool
} from "@/lib/database";
import {
  runGoogleCalendarSync
} from "@/lib/google-sync";
import {
  runMicrosoftCalendarSync
} from "@/lib/microsoft-sync";
import {
  resolveWorkspaceHumanPrincipal
} from "@/lib/principal";

const RequestSchema = z.object({
  workspaceSlug:
    z.string().min(1),
  idempotencyKey:
    z.string().uuid(),
  command:
    CreateCalendarEventInputSchema.omit({
      workspaceId: true
    })
}).strict();

export async function POST(
  request: Request
) {
  const body =
    await request.json().catch(
      () => null
    );

  const parsed =
    RequestSchema.safeParse(
      body
    );

  if (!parsed.success) {
    return Response.json(
      {
        status: "FAILED",
        humanSummary:
          "Kalenderbegivenheden kunne ikke valideres."
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
        createCalendarEventAction(),
      principal,
      rawInput: {
        workspaceId:
          principal.workspaceId,
        ...parsed.data.command
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
          persistCreatedCalendarEvent(
            db,
            {
              workspaceId:
                principal.workspaceId,
              calendarSourceId:
                result.data!
                  .calendarSourceId,
              providerResult:
                result.data!
                  .providerResult,
              originActorType:
                principal
                  .principalType,
              originActorId:
                principal
                  .principalId
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
              "Begivenheden blev oprettet hos kalenderudbyderen. Den lokale kalender afventer ny synkronisering.",
            recovery: {
              label:
                "Synkronisér kalender",
              action:
                result.data
                  .provider ===
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

  const statusCode =
    result.status ===
    "SUCCEEDED"
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
            : 502;

  return Response.json(
    result,
    {
      status:
        statusCode
    }
  );
}
