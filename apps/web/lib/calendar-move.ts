import type {
  MoveCalendarEventInput
} from "@skrivebord/contracts";
import type {
  CalendarMoveTarget
} from "@skrivebord/database";

export class CalendarMoveError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false
  ) {
    super(message);
    this.name = "CalendarMoveError";
  }
}

export function buildGoogleCalendarMovePatch(input: {
  target:
    | CalendarMoveTarget
    | undefined;
  command:
    MoveCalendarEventInput;
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
    target.requestedRecurrenceMasterId
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
