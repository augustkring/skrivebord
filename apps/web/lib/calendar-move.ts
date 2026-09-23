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

  const baselineDuration =
    command.scope === "SERIES" &&
    target.requestedRecurrenceMasterId
      ? target.endAt.getTime() -
        target.startAt.getTime()
      : target.requestedEndAt.getTime() -
        target.requestedStartAt.getTime();

  const desiredDuration =
    desiredEnd.getTime() -
    desiredStart.getTime();

  if (
    baselineDuration !==
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
    if (
      !target
        .requestedRecurrenceOriginalStartAt
    ) {
      throw new CalendarMoveError(
        "CALENDAR_RECURRENCE_ORIGINAL_START_REQUIRED",
        "Den valgte forekomst skal synkroniseres igen, før hele serien kan flyttes."
      );
    }

    const deltaMs =
      desiredStart.getTime() -
      target
        .requestedRecurrenceOriginalStartAt
        .getTime();

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


export function calendarMoveFailurePresentation(
  code?: string,
  retryable = false
): {
  humanSummary: string;
  recovery?: {
    label: string;
    action: string;
  };
} {
  switch (code) {
    case "CALENDAR_PROVIDER_CONFLICT":
    case "CONFLICT":
      return {
        humanSummary:
          "Begivenheden er ændret i Google siden sidste synkronisering. Gennemgå den nyeste version og prøv igen.",
        recovery: {
          label: "Gennemgå kalender",
          action: "calendar.get_event"
        }
      };

    case "AUTH_EXPIRED":
      return {
        humanSummary:
          "Google Calendar skal forbindes igen, før begivenheden kan ændres.",
        recovery: {
          label: "Forbind Google igen",
          action: "connection.reconnect"
        }
      };

    case "RATE_LIMITED":
    case "UNAVAILABLE":
      return {
        humanSummary:
          "Google Calendar er midlertidigt utilgængelig. Prøv igen om lidt.",
        recovery: {
          label: "Prøv igen",
          action: "calendar.move_event"
        }
      };

    case "CALENDAR_SOURCE_NOT_WRITABLE":
      return {
        humanSummary:
          "Kalenderen kan ikke ændres i sin nuværende tilstand."
      };

    case "CALENDAR_EVENT_VERSION_REQUIRED":
      return {
        humanSummary:
          "Begivenheden skal synkroniseres igen, før den kan ændres.",
        recovery: {
          label: "Synkronisér kalender",
          action: "connection.google.sync"
        }
      };

    case "ALL_DAY_MOVE_NOT_SUPPORTED":
      return {
        humanSummary:
          "Heldagsbegivenheder kan endnu ikke flyttes med denne handling."
      };

    case "CALENDAR_MOVE_CANNOT_RESIZE":
      return {
        humanSummary:
          "Flytning må ikke ændre begivenhedens varighed."
      };

    default:
      return {
        humanSummary:
          retryable
            ? "Kalenderændringen kunne ikke gennemføres lige nu. Prøv igen."
            : "Kalenderændringen kunne ikke gennemføres."
      };
  }
}
