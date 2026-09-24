import { describe, expect, it } from "vitest";
import type {
  CalendarMoveTarget
} from "@skrivebord/database";
import {
  buildGoogleCalendarMovePatch,
  calendarMoveFailurePresentation,
  CalendarMoveError
} from "./calendar-move";

function target(
  overrides: Partial<CalendarMoveTarget> = {}
): CalendarMoveTarget {
  return {
    requestedEventId:
      "11111111-1111-4111-8111-111111111111",
    requestedStartAt:
      new Date("2026-09-25T08:00:00Z"),
    requestedEndAt:
      new Date("2026-09-25T09:00:00Z"),
    localTargetEventId:
      "11111111-1111-4111-8111-111111111111",
    calendarSourceId:
      "22222222-2222-4222-8222-222222222222",
    connectorAccountId:
      "33333333-3333-4333-8333-333333333333",
    provider: "GOOGLE",
    providerCalendarId: "primary",
    providerEventId: "google-event",
    providerVersion: "etag-v1",
    title: "Rengøring",
    startAt:
      new Date("2026-09-25T08:00:00Z"),
    endAt:
      new Date("2026-09-25T09:00:00Z"),
    timezone: "Europe/Copenhagen",
    allDay: false,
    status: "CONFIRMED",
    writable: true,
    syncState: "CONNECTED",
    ...overrides
  };
}

describe("Google calendar move semantics", () => {
  it("moves a standalone event without changing its duration", () => {
    const patch =
      buildGoogleCalendarMovePatch({
        target: target(),
        command: {
          workspaceId: "workspace-a",
          eventId:
            "11111111-1111-4111-8111-111111111111",
          startsAt:
            "2026-09-25T12:00:00Z",
          endsAt:
            "2026-09-25T13:00:00Z",
          scope: "OCCURRENCE"
        }
      });

    expect(patch).toEqual({
      start: {
        dateTime:
          "2026-09-25T12:00:00.000Z",
        timeZone:
          "Europe/Copenhagen"
      },
      end: {
        dateTime:
          "2026-09-25T13:00:00.000Z",
        timeZone:
          "Europe/Copenhagen"
      }
    });
  });


  it("moves a concrete recurring instance without shifting the series master", () => {
    const patch =
      buildGoogleCalendarMovePatch({
        target: target({
          providerEventId:
            "instance-20260925",
          recurrenceMasterId:
            "series-master",
          recurrenceRule:
            undefined
        }),
        command: {
          workspaceId:
            "workspace-a",
          eventId:
            "11111111-1111-4111-8111-111111111111",
          startsAt:
            "2026-09-25T14:00:00Z",
          endsAt:
            "2026-09-25T15:00:00Z",
          scope: "OCCURRENCE"
        }
      });

    expect(patch).toEqual({
      start: {
        dateTime:
          "2026-09-25T14:00:00.000Z",
        timeZone:
          "Europe/Copenhagen"
      },
      end: {
        dateTime:
          "2026-09-25T15:00:00.000Z",
        timeZone:
          "Europe/Copenhagen"
      }
    });
  });

  it("allows Microsoft events through the same move semantics", () => {
    const patch =
      buildGoogleCalendarMovePatch({
        target: target({
          provider:
            "MICROSOFT",
          providerEventId:
            "ms-event-1",
          providerVersion:
            "W/\"etag-1\""
        }),
        command: {
          workspaceId:
            "workspace-a",
          eventId:
            "11111111-1111-4111-8111-111111111111",
          startsAt:
            "2026-09-25T10:00:00Z",
          endsAt:
            "2026-09-25T11:00:00Z",
          scope:
            "OCCURRENCE"
        }
      });

    expect(
      patch.start.dateTime
    ).toBe(
      "2026-09-25T10:00:00.000Z"
    );
  });

  it("allows moves when the synchronized source is healthy", () => {
    const patch =
      buildGoogleCalendarMovePatch({
        target: target({
          syncState: "HEALTHY"
        }),
        command: {
          workspaceId:
            "workspace-a",
          eventId:
            "11111111-1111-4111-8111-111111111111",
          startsAt:
            "2026-09-25T10:00:00Z",
          endsAt:
            "2026-09-25T11:00:00Z",
          scope:
            "OCCURRENCE"
        }
      });

    expect(
      patch.start.dateTime
    ).toBe(
      "2026-09-25T10:00:00.000Z"
    );
  });

  it("requires a provider version before a write can be attempted", () => {
    expect(() =>
      buildGoogleCalendarMovePatch({
        target: target({
          providerVersion:
            undefined
        }),
        command: {
          workspaceId:
            "workspace-a",
          eventId:
            "11111111-1111-4111-8111-111111111111",
          startsAt:
            "2026-09-25T10:00:00Z",
          endsAt:
            "2026-09-25T11:00:00Z",
          scope: "OCCURRENCE"
        }
      })
    ).toMatchObject({
      code:
        "CALENDAR_EVENT_VERSION_REQUIRED",
      retryable: false
    });
  });

  it("moves the recurring master by the selected occurrence delta for SERIES", () => {
    const patch =
      buildGoogleCalendarMovePatch({
        target: target({
          requestedStartAt:
            new Date(
              "2026-10-02T08:00:00Z"
            ),
          requestedEndAt:
            new Date(
              "2026-10-02T09:00:00Z"
            ),
          requestedRecurrenceMasterId:
            "series-master",
          requestedRecurrenceOriginalStartAt:
            new Date(
              "2026-10-02T08:00:00Z"
            ),
          localTargetEventId:
            "44444444-4444-4444-8444-444444444444",
          providerEventId:
            "series-master",
          startAt:
            new Date(
              "2026-09-25T08:00:00Z"
            ),
          endAt:
            new Date(
              "2026-09-25T09:00:00Z"
            ),
          recurrenceRule:
            "RRULE:FREQ=WEEKLY"
        }),
        command: {
          workspaceId: "workspace-a",
          eventId:
            "11111111-1111-4111-8111-111111111111",
          startsAt:
            "2026-10-02T10:00:00Z",
          endsAt:
            "2026-10-02T11:00:00Z",
          scope: "SERIES"
        }
      });

    expect(patch.start.dateTime).toBe(
      "2026-09-25T10:00:00.000Z"
    );
    expect(patch.end.dateTime).toBe(
      "2026-09-25T11:00:00.000Z"
    );
  });


  it("uses originalStartTime when an exception is used to move the whole series", () => {
    const patch =
      buildGoogleCalendarMovePatch({
        target: target({
          requestedStartAt:
            new Date(
              "2026-10-02T09:00:00Z"
            ),
          requestedEndAt:
            new Date(
              "2026-10-02T10:00:00Z"
            ),
          requestedRecurrenceMasterId:
            "series-master",
          requestedRecurrenceOriginalStartAt:
            new Date(
              "2026-10-02T08:00:00Z"
            ),
          localTargetEventId:
            "44444444-4444-4444-8444-444444444444",
          providerEventId:
            "series-master",
          startAt:
            new Date(
              "2026-09-25T08:00:00Z"
            ),
          endAt:
            new Date(
              "2026-09-25T09:00:00Z"
            ),
          recurrenceRule:
            "RRULE:FREQ=WEEKLY"
        }),
        command: {
          workspaceId:
            "workspace-a",
          eventId:
            "11111111-1111-4111-8111-111111111111",
          startsAt:
            "2026-10-02T10:00:00Z",
          endsAt:
            "2026-10-02T11:00:00Z",
          scope: "SERIES"
        }
      });

    expect(
      patch.start.dateTime
    ).toBe(
      "2026-09-25T10:00:00.000Z"
    );
    expect(
      patch.end.dateTime
    ).toBe(
      "2026-09-25T11:00:00.000Z"
    );
  });

  it("rejects series moves from an instance when originalStartTime is missing", () => {
    expect(() =>
      buildGoogleCalendarMovePatch({
        target: target({
          requestedRecurrenceMasterId:
            "series-master",
          requestedRecurrenceOriginalStartAt:
            undefined,
          localTargetEventId:
            "44444444-4444-4444-8444-444444444444",
          providerEventId:
            "series-master",
          recurrenceRule:
            "RRULE:FREQ=WEEKLY"
        }),
        command: {
          workspaceId:
            "workspace-a",
          eventId:
            "11111111-1111-4111-8111-111111111111",
          startsAt:
            "2026-09-25T10:00:00Z",
          endsAt:
            "2026-09-25T11:00:00Z",
          scope: "SERIES"
        }
      })
    ).toMatchObject({
      code:
        "CALENDAR_RECURRENCE_ORIGINAL_START_REQUIRED"
    });
  });

  it("rejects moving only one occurrence when the selected row is the recurring master", () => {
    expect(() =>
      buildGoogleCalendarMovePatch({
        target: target({
          recurrenceRule:
            "RRULE:FREQ=WEEKLY",
          recurrenceMasterId:
            undefined
        }),
        command: {
          workspaceId: "workspace-a",
          eventId:
            "11111111-1111-4111-8111-111111111111",
          startsAt:
            "2026-09-25T10:00:00Z",
          endsAt:
            "2026-09-25T11:00:00Z",
          scope: "OCCURRENCE"
        }
      })
    ).toMatchObject<Partial<CalendarMoveError>>({
      code:
        "CALENDAR_OCCURRENCE_REQUIRES_INSTANCE",
      retryable: false
    });
  });

  it("rejects resize disguised as a move", () => {
    expect(() =>
      buildGoogleCalendarMovePatch({
        target: target(),
        command: {
          workspaceId: "workspace-a",
          eventId:
            "11111111-1111-4111-8111-111111111111",
          startsAt:
            "2026-09-25T10:00:00Z",
          endsAt:
            "2026-09-25T12:00:00Z",
          scope: "OCCURRENCE"
        }
      })
    ).toMatchObject<Partial<CalendarMoveError>>({
      code:
        "CALENDAR_MOVE_CANNOT_RESIZE",
      retryable: false
    });
  });


  it("maps provider failures to customer-safe recovery copy", () => {
    expect(
      calendarMoveFailurePresentation(
        "CALENDAR_PROVIDER_CONFLICT",
        false
      )
    ).toEqual({
      humanSummary:
        "Begivenheden er ændret i Google siden sidste synkronisering. Gennemgå den nyeste version og prøv igen.",
      recovery: {
        label:
          "Gennemgå kalender",
        action:
          "calendar.get_event"
      }
    });

    expect(
      calendarMoveFailurePresentation(
        "RATE_LIMITED",
        true
      )
    ).toMatchObject({
      recovery: {
        action:
          "calendar.move_event"
      }
    });

    expect(
      calendarMoveFailurePresentation(
        "AUTH_EXPIRED",
        false
      )
    ).toMatchObject({
      recovery: {
        action:
          "connection.reconnect"
      }
    });
  });

  it("rejects non-writable and all-day sources before provider access", () => {
    expect(() =>
      buildGoogleCalendarMovePatch({
        target: target({
          writable: false
        }),
        command: {
          workspaceId: "workspace-a",
          eventId:
            "11111111-1111-4111-8111-111111111111",
          startsAt:
            "2026-09-25T10:00:00Z",
          endsAt:
            "2026-09-25T11:00:00Z",
          scope: "OCCURRENCE"
        }
      })
    ).toMatchObject({
      code:
        "CALENDAR_SOURCE_NOT_WRITABLE"
    });

    expect(() =>
      buildGoogleCalendarMovePatch({
        target: target({
          allDay: true
        }),
        command: {
          workspaceId: "workspace-a",
          eventId:
            "11111111-1111-4111-8111-111111111111",
          startsAt:
            "2026-09-25T10:00:00Z",
          endsAt:
            "2026-09-25T11:00:00Z",
          scope: "OCCURRENCE"
        }
      })
    ).toMatchObject({
      code:
        "ALL_DAY_MOVE_NOT_SUPPORTED"
    });
  });
});
