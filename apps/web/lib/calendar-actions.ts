import type {
  ActionDefinition
} from "@skrivebord/actions";
import {
  ConnectorError,
  GoogleCalendarConnector,
  MicrosoftCalendarConnector,
  type CalendarConnector,
  type CalendarSyncEvent
} from "@skrivebord/connectors";
import {
  MoveCalendarEventInputSchema,
  type MoveCalendarEventInput
} from "@skrivebord/contracts";
import {
  getCalendarMoveTarget,
  persistCalendarWriteResult,
  withPrincipalTransaction,
  type CalendarMoveTarget
} from "@skrivebord/database";
import {
  buildCalendarMovePatch,
  CalendarMoveError
} from "./calendar-move";
import { databasePool } from "./database";
import {
  getGoogleAccessContext
} from "./google-access";
import {
  getMicrosoftAccessContext
} from "./microsoft-access";

export type MoveCalendarEventResult = {
  provider:
    | "GOOGLE"
    | "MICROSOFT";
  localTargetEventId: string;
  calendarSourceId: string;
  providerEventId: string;
  providerVersion?: string;
  externalEffectRef: string;
  providerResult:
    CalendarSyncEvent;
};

const InputSchema =
  MoveCalendarEventInputSchema.superRefine(
    (value, ctx) => {
      const startsAt =
        new Date(value.startsAt);
      const endsAt =
        new Date(value.endsAt);

      if (
        endsAt.getTime() <=
        startsAt.getTime()
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            "Sluttid skal ligge efter starttid."
        });
      }
    }
  );

function providerLabel(
  provider: string
): string {
  if (provider === "GOOGLE") {
    return "Google Calendar";
  }

  if (
    provider === "MICROSOFT"
  ) {
    return "Microsoft Calendar";
  }

  return "kalenderudbyderen";
}

async function connectorForTarget(
  target: CalendarMoveTarget,
  workspaceId: string,
  requestId: string,
  now: Date
): Promise<{
  connector: CalendarConnector;
  accessToken: string;
}> {
  if (
    target.provider === "GOOGLE"
  ) {
    const access =
      await getGoogleAccessContext({
        workspaceId,
        connectorAccountId:
          target.connectorAccountId,
        jobId:
          `system:calendar-move:${requestId}`,
        now
      });

    return {
      connector:
        new GoogleCalendarConnector(),
      accessToken:
        access.tokens.accessToken
    };
  }

  if (
    target.provider ===
    "MICROSOFT"
  ) {
    const access =
      await getMicrosoftAccessContext({
        workspaceId,
        connectorAccountId:
          target.connectorAccountId,
        jobId:
          `system:calendar-move:${requestId}`,
        now
      });

    return {
      connector:
        new MicrosoftCalendarConnector(),
      accessToken:
        access.tokens.accessToken
    };
  }

  throw new CalendarMoveError(
    "CALENDAR_PROVIDER_UNSUPPORTED",
    "Denne kalenderprovider understøtter ikke flytning endnu."
  );
}

export function createMoveCalendarEventAction(): ActionDefinition<
  MoveCalendarEventInput,
  MoveCalendarEventResult
> {
  return {
    id: "calendar.move",
    input: InputSchema,
    requiredCapabilities: [
      "calendar.update"
    ],
    risk: () => "MEDIUM",
    reversible: true,
    idempotency: "REQUIRED",
    preview: async ({
      principal,
      input
    }) => {
      const target =
        await withPrincipalTransaction(
          databasePool,
          principal,
          ({ db }) =>
            getCalendarMoveTarget(
              db,
              {
                workspaceId:
                  principal.workspaceId,
                eventId:
                  input.eventId,
                scope:
                  input.scope
              }
            )
        );

      return target
        ? `Flyt ${target.title}`
        : "Flyt kalenderbegivenhed";
    },
    approval: {
      requiredApproverScope:
        "OWNER",
      consequenceSummary: ({
        input
      }) =>
        input.scope === "SERIES"
          ? "Flytter hele den tilbagevendende kalenderbegivenhed hos den eksterne kalenderudbyder."
          : "Flytter kalenderbegivenheden hos den eksterne kalenderudbyder.",
      reversibility:
        "PARTIALLY_REVERSIBLE"
    },
    execute: async ({
      principal,
      input,
      now
    }) => {
      const target =
        await withPrincipalTransaction(
          databasePool,
          principal,
          ({ db }) =>
            getCalendarMoveTarget(
              db,
              {
                workspaceId:
                  principal.workspaceId,
                eventId:
                  input.eventId,
                scope:
                  input.scope
              }
            )
        );

      const patch =
        buildCalendarMovePatch({
          target,
          command: input
        });

      if (!target) {
        throw new CalendarMoveError(
          "CALENDAR_EVENT_NOT_FOUND",
          "Kalenderbegivenheden blev ikke fundet."
        );
      }

      const {
        connector,
        accessToken
      } =
        await connectorForTarget(
          target,
          principal.workspaceId,
          principal.requestId,
          now
        );

      let providerResult:
        CalendarSyncEvent;

      try {
        providerResult =
          await connector.updateEvent({
            accessToken,
            calendarId:
              target.providerCalendarId,
            eventId:
              target.providerEventId,
            providerVersion:
              target.providerVersion,
            event: patch
          });
      } catch (error) {
        if (
          error instanceof
            ConnectorError &&
          error.code ===
            "CONFLICT"
        ) {
          try {
            const current =
              await connector.getEvent({
                accessToken,
                calendarId:
                  target
                    .providerCalendarId,
                eventId:
                  target
                    .providerEventId
              });

            await withPrincipalTransaction(
              databasePool,
              principal,
              ({ db }) =>
                persistCalendarWriteResult(
                  db,
                  {
                    workspaceId:
                      principal
                        .workspaceId,
                    localTargetEventId:
                      target
                        .localTargetEventId,
                    providerResult:
                      current,
                    now
                  }
                )
            );
          } catch {
            // Preserve the original provider conflict as authoritative.
          }

          throw new CalendarMoveError(
            "CALENDAR_PROVIDER_CONFLICT",
            `Begivenheden er ændret i ${providerLabel(target.provider)} siden sidste synkronisering. Skrivebord har forsøgt at hente den nyeste version; gennemgå begivenheden og prøv igen.`
          );
        }

        throw error;
      }

      return {
        provider:
          target.provider as
            | "GOOGLE"
            | "MICROSOFT",
        localTargetEventId:
          target.localTargetEventId,
        calendarSourceId:
          target.calendarSourceId,
        providerEventId:
          target.providerEventId,
        providerVersion:
          providerResult
            .providerVersion,
        externalEffectRef:
          `${target.provider.toLowerCase()}:calendar:${target.providerCalendarId}:event:${target.providerEventId}`,
        providerResult
      };
    },
    externalEffectRefs: (
      result
    ) => [
      result.externalEffectRef
    ],
    classifyFailure: (
      error
    ) => {
      if (
        error instanceof
        ConnectorError
      ) {
        return {
          code: error.code,
          summary:
            error.message,
          retryable:
            error.retryable
        };
      }

      if (
        error instanceof
        CalendarMoveError
      ) {
        return {
          code: error.code,
          summary:
            error.message,
          retryable:
            error.retryable
        };
      }

      return {
        code:
          "CALENDAR_MOVE_FAILED",
        summary:
          error instanceof Error
            ? error.message
            : undefined,
        retryable: false
      };
    }
  };
}
