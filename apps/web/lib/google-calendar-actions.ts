import type {
  ActionDefinition
} from "@skrivebord/actions";
import {
  ConnectorError,
  GoogleCalendarConnector,
  type CalendarSyncEvent
} from "@skrivebord/connectors";
import {
  MoveCalendarEventInputSchema,
  type MoveCalendarEventInput
} from "@skrivebord/contracts";
import {
  getCalendarMoveTarget,
  withPrincipalTransaction
} from "@skrivebord/database";
import {
  CalendarMoveError,
  buildGoogleCalendarMovePatch
} from "./calendar-move";
import { databasePool } from "./database";
import {
  getGoogleAccessContext
} from "./google-access";

export type MoveGoogleCalendarEventResult = {
  localTargetEventId: string;
  calendarSourceId: string;
  providerEventId: string;
  providerVersion?: string;
  externalEffectRef: string;
  providerResult: CalendarSyncEvent;
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

export function createMoveGoogleCalendarEventAction(): ActionDefinition<
  MoveCalendarEventInput,
  MoveGoogleCalendarEventResult
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
          ? "Flytter hele den tilbagevendende kalenderbegivenhed hos Google."
          : "Flytter kalenderbegivenheden hos Google.",
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
        buildGoogleCalendarMovePatch({
          target,
          command: input
        });

      if (!target) {
        throw new CalendarMoveError(
          "CALENDAR_EVENT_NOT_FOUND",
          "Kalenderbegivenheden blev ikke fundet."
        );
      }

      const access =
        await getGoogleAccessContext({
          workspaceId:
            principal.workspaceId,
          connectorAccountId:
            target.connectorAccountId,
          jobId:
            `system:calendar-move:${principal.requestId}`,
          now
        });

      const connector =
        new GoogleCalendarConnector();

      const providerResult =
        await connector.updateEvent({
          accessToken:
            access.tokens.accessToken,
          calendarId:
            target.providerCalendarId,
          eventId:
            target.providerEventId,
          providerVersion:
            target.providerVersion,
          event: patch
        });

      return {
        localTargetEventId:
          target.localTargetEventId,
        calendarSourceId:
          target.calendarSourceId,
        providerEventId:
          target.providerEventId,
        providerVersion:
          providerResult.providerVersion,
        externalEffectRef:
          `google:calendar:${target.providerCalendarId}:event:${target.providerEventId}`,
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
