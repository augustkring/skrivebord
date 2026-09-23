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

class CalendarMoveError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false
  ) {
    super(message);
    this.name = "CalendarMoveError";
  }
}

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

function movePatch(input: {
  target: Awaited<
    ReturnType<
      typeof getCalendarMoveTarget
    >
  >;
  command: MoveCalendarEventInput;
}) {
  const {
    target,
    command
  } = input;

  if (!target) {
    throw new CalendarMoveError(
      "CALENDAR_EVENT_NOT_FOUND",
      "Kalenderbegivenheden blev ikke fundet."
    );
  }

  if (
    target.provider !== "GOOGLE"
  ) {
    throw new CalendarMoveError(
      "CALENDAR_PROVIDER_UNSUPPORTED",
      "Denne kalenderprovider understøtter ikke flytning endnu."
    );
  }

  if (
    !target.writable ||
    target.syncState !==
      "CONNECTED"
  ) {
    throw new CalendarMoveError(
      "CALENDAR_SOURCE_NOT_WRITABLE",
      "Kalenderen kan ikke ændres i sin nuværende tilstand."
    );
  }

  if (
    target.status !==
    "CONFIRMED"
  ) {
    throw new CalendarMoveError(
      "CALENDAR_EVENT_NOT_ACTIVE",
      "Begivenheden er ikke aktiv."
    );
  }

  if (target.allDay) {
    throw new CalendarMoveError(
      "ALL_DAY_MOVE_NOT_SUPPORTED",
      "Heldagsbegivenheder kræver en separat datobaseret flytning."
    );
  }

  if (
    !target.providerVersion
  ) {
    throw new CalendarMoveError(
      "CALENDAR_EVENT_VERSION_REQUIRED",
      "Begivenheden skal synkroniseres igen før den kan ændres."
    );
  }

  if (
    !target.startAt ||
    !target.endAt ||
    !target.requestedStartAt ||
    !target.requestedEndAt
  ) {
    throw new CalendarMoveError(
      "CALENDAR_EVENT_TIME_REQUIRED",
      "Begivenheden mangler et gyldigt tidsinterval."
    );
  }

  if (
    command.scope ===
      "OCCURRENCE" &&
    target.recurrenceRule &&
    !target.recurrenceMasterId
  ) {
    throw new CalendarMoveError(
      "CALENDAR_OCCURRENCE_REQUIRES_INSTANCE",
      "En enkelt forekomst kan kun flyttes, når forekomsten har sit eget provider-ID."
    );
  }

  const desiredStart =
    new Date(command.startsAt);
  const desiredEnd =
    new Date(command.endsAt);

  const requestedDuration =
    target.requestedEndAt.getTime() -
    target.requestedStartAt.getTime();
  const desiredDuration =
    desiredEnd.getTime() -
    desiredStart.getTime();

  if (
    requestedDuration !==
    desiredDuration
  ) {
    throw new CalendarMoveError(
      "CALENDAR_MOVE_CANNOT_RESIZE",
      "Flytning må ikke ændre begivenhedens varighed."
    );
  }

  let nextStart =
    desiredStart;
  let nextEnd =
    desiredEnd;

  if (
    command.scope === "SERIES" &&
    target.recurrenceMasterId
  ) {
    const deltaMs =
      desiredStart.getTime() -
      target.requestedStartAt.getTime();

    nextStart = new Date(
      target.startAt.getTime() +
        deltaMs
    );
    nextEnd = new Date(
      target.endAt.getTime() +
        deltaMs
    );
  }

  return {
    start: {
      dateTime:
        nextStart.toISOString(),
      ...(target.timezone
        ? {
            timeZone:
              target.timezone
          }
        : {})
    },
    end: {
      dateTime:
        nextEnd.toISOString(),
      ...(target.timezone
        ? {
            timeZone:
              target.timezone
          }
        : {})
    }
  };
}

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
        movePatch({
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
