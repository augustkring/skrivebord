import {
  ConnectorError,
  type CalendarConnector,
  type CalendarEventWrite,
  type CalendarSyncEvent,
  type CalendarSyncResult,
  type CreateCalendarEventInput,
  type DeleteCalendarEventInput,
  type IncrementalCalendarSyncInput,
  type InitialCalendarSyncInput,
  type UpdateCalendarEventInput
} from "./calendar";

type GoogleEventDateTime = {
  dateTime?: string;
  date?: string;
  timeZone?: string;
};

type GoogleEvent = {
  id?: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
  recurringEventId?: string;
  recurrence?: string[];
  updated?: string;
};

type GoogleEventsPage = {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

const GOOGLE_CALENDAR_BASE =
  "https://www.googleapis.com/calendar/v3";

function cleanDescription(value?: string): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .slice(0, 20_000);
}

function normalizeGoogleEvent(event: GoogleEvent): CalendarSyncEvent {
  if (!event.id) {
    throw new ConnectorError(
      "Google event mangler ID.",
      "INVALID_RESPONSE",
      false
    );
  }

  const allDay = Boolean(event.start?.date);
  const startAt = event.start?.dateTime;
  const endAt = event.end?.dateTime;
  const startDate = event.start?.date;
  const endDate = event.end?.date;

  if (allDay && !startDate) {
    throw new ConnectorError(
      "All-day event mangler startdato.",
      "INVALID_RESPONSE",
      false
    );
  }

  if (!allDay && !startAt && event.status !== "cancelled") {
    throw new ConnectorError(
      "Timed event mangler starttid.",
      "INVALID_RESPONSE",
      false
    );
  }

  return {
    providerEventId: event.id,
    providerVersion: event.etag,
    title: event.summary?.trim() || "(Uden titel)",
    descriptionSanitized: cleanDescription(event.description),
    startAt,
    endAt,
    startDate,
    endDate,
    allDay,
    timezone: event.start?.timeZone ?? event.end?.timeZone,
    recurrenceMasterId: event.recurringEventId,
    recurrenceRule: event.recurrence?.join("\n"),
    status:
      event.status === "cancelled"
        ? "CANCELLED"
        : "CONFIRMED",
    sourceUpdatedAt: event.updated
  };
}

function connectorError(
  response: Response,
  operation: string
): ConnectorError {
  if (response.status === 401 || response.status === 403) {
    return new ConnectorError(
      `${operation}: Google-adgangen er udløbet eller utilstrækkelig.`,
      "AUTH_EXPIRED",
      false,
      response.status
    );
  }

  if (response.status === 409 || response.status === 412) {
    return new ConnectorError(
      `${operation}: Provider-state har ændret sig.`,
      "CONFLICT",
      false,
      response.status
    );
  }

  if (response.status === 429) {
    return new ConnectorError(
      `${operation}: Google rate limit.`,
      "RATE_LIMITED",
      true,
      response.status
    );
  }

  if (response.status >= 500) {
    return new ConnectorError(
      `${operation}: Google er midlertidigt utilgængelig.`,
      "UNAVAILABLE",
      true,
      response.status
    );
  }

  return new ConnectorError(
    `${operation}: Uventet Google-fejl.`,
    "INVALID_RESPONSE",
    false,
    response.status
  );
}

function authHeaders(
  accessToken: string,
  providerVersion?: string
): HeadersInit {
  return {
    authorization: `Bearer ${accessToken}`,
    accept: "application/json",
    ...(providerVersion
      ? { "if-match": providerVersion }
      : {})
  };
}

function bodyHeaders(
  accessToken: string,
  providerVersion?: string
): HeadersInit {
  return {
    ...authHeaders(accessToken, providerVersion),
    "content-type": "application/json"
  };
}

function eventBody(event: CalendarEventWrite) {
  return {
    summary: event.title,
    description: event.description,
    start: event.start,
    end: event.end,
    recurrence: event.recurrence
  };
}

export class GoogleCalendarConnector
  implements CalendarConnector
{
  readonly provider = "GOOGLE" as const;

  constructor(
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async initialSync(
    input: InitialCalendarSyncInput
  ): Promise<CalendarSyncResult> {
    const params = new URLSearchParams({
      maxResults: "2500",
      singleEvents: "false"
    });

    if (input.timeMin) params.set("timeMin", input.timeMin);
    if (input.timeMax) params.set("timeMax", input.timeMax);

    return this.syncPages({
      accessToken: input.accessToken,
      calendarId: input.calendarId,
      params,
      allow410: false
    });
  }

  async incrementalSync(
    input: IncrementalCalendarSyncInput
  ): Promise<CalendarSyncResult> {
    if (input.cursor.type !== "GOOGLE_SYNC_TOKEN") {
      throw new ConnectorError(
        "Google connector modtog en cursor fra en anden provider.",
        "INVALID_RESPONSE",
        false
      );
    }

    const params = new URLSearchParams({
      maxResults: "2500",
      singleEvents: "false",
      syncToken: input.cursor.value
    });

    return this.syncPages({
      accessToken: input.accessToken,
      calendarId: input.calendarId,
      params,
      allow410: true
    });
  }

  private async syncPages(input: {
    accessToken: string;
    calendarId: string;
    params: URLSearchParams;
    allow410: boolean;
  }): Promise<CalendarSyncResult> {
    const events: CalendarSyncEvent[] = [];
    let nextPageToken: string | undefined;
    let nextSyncToken: string | undefined;

    do {
      const params = new URLSearchParams(input.params);
      if (nextPageToken) {
        params.set("pageToken", nextPageToken);
      }

      const response = await this.fetchImpl(
        `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(input.calendarId)}/events?${params.toString()}`,
        {
          method: "GET",
          headers: authHeaders(input.accessToken)
        }
      );

      if (input.allow410 && response.status === 410) {
        return {
          events: [],
          fullResyncRequired: true
        };
      }

      if (!response.ok) {
        throw connectorError(response, "calendar.events.list");
      }

      const page = (await response.json()) as GoogleEventsPage;

      for (const event of page.items ?? []) {
        events.push(normalizeGoogleEvent(event));
      }

      nextPageToken = page.nextPageToken;
      nextSyncToken = page.nextSyncToken ?? nextSyncToken;
    } while (nextPageToken);

    if (!nextSyncToken) {
      throw new ConnectorError(
        "Google returnerede ikke nextSyncToken på sidste side.",
        "INVALID_RESPONSE",
        false
      );
    }

    return {
      events,
      cursor: {
        type: "GOOGLE_SYNC_TOKEN",
        value: nextSyncToken
      },
      fullResyncRequired: false
    };
  }

  async createEvent(
    input: CreateCalendarEventInput
  ): Promise<CalendarSyncEvent> {
    const response = await this.fetchImpl(
      `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(input.calendarId)}/events`,
      {
        method: "POST",
        headers: bodyHeaders(input.accessToken),
        body: JSON.stringify(eventBody(input.event))
      }
    );

    if (!response.ok) {
      throw connectorError(response, "calendar.events.insert");
    }

    return normalizeGoogleEvent(
      (await response.json()) as GoogleEvent
    );
  }

  async updateEvent(
    input: UpdateCalendarEventInput
  ): Promise<CalendarSyncEvent> {
    const response = await this.fetchImpl(
      `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
      {
        method: "PATCH",
        headers: bodyHeaders(
          input.accessToken,
          input.providerVersion
        ),
        body: JSON.stringify(eventBody(input.event))
      }
    );

    if (!response.ok) {
      throw connectorError(response, "calendar.events.patch");
    }

    return normalizeGoogleEvent(
      (await response.json()) as GoogleEvent
    );
  }

  async deleteEvent(
    input: DeleteCalendarEventInput
  ): Promise<void> {
    const response = await this.fetchImpl(
      `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
      {
        method: "DELETE",
        headers: authHeaders(
          input.accessToken,
          input.providerVersion
        )
      }
    );

    if (!response.ok && response.status !== 410) {
      throw connectorError(response, "calendar.events.delete");
    }
  }
}
