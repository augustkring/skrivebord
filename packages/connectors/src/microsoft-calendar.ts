import {
  ConnectorError,
  type CalendarConnector,
  type CalendarEventPatch,
  type CalendarEventWrite,
  type CalendarSyncEvent,
  type CalendarSyncResult,
  type CreateCalendarEventInput,
  type DeleteCalendarEventInput,
  type GetCalendarEventInput,
  type IncrementalCalendarSyncInput,
  type InitialCalendarSyncInput,
  type ListCalendarEventInstancesInput,
  type UpdateCalendarEventInput
} from "./calendar";

const GRAPH_BASE =
  "https://graph.microsoft.com/v1.0";

type GraphDateTimeTimeZone = {
  dateTime?: string;
  timeZone?: string;
};

type GraphEvent = {
  id?: string;
  "@odata.etag"?: string;
  subject?: string;
  bodyPreview?: string;
  start?: GraphDateTimeTimeZone;
  end?: GraphDateTimeTimeZone;
  isAllDay?: boolean;
  isCancelled?: boolean;
  seriesMasterId?: string;
  originalStart?: string;
  recurrence?: unknown;
  lastModifiedDateTime?: string;
  "@removed"?: {
    reason?: string;
  };
};

type GraphDeltaPage = {
  value?: GraphEvent[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
};

function graphError(
  response: Response,
  operation: string
): ConnectorError {
  if (
    response.status === 401 ||
    response.status === 403
  ) {
    return new ConnectorError(
      `${operation}: Microsoft-adgangen er udløbet eller utilstrækkelig.`,
      "AUTH_EXPIRED",
      false,
      response.status
    );
  }

  if (
    response.status === 409 ||
    response.status === 412
  ) {
    return new ConnectorError(
      `${operation}: Microsoft-state har ændret sig.`,
      "CONFLICT",
      false,
      response.status
    );
  }

  if (response.status === 429) {
    return new ConnectorError(
      `${operation}: Microsoft Graph rate limit.`,
      "RATE_LIMITED",
      true,
      response.status
    );
  }

  if (response.status >= 500) {
    return new ConnectorError(
      `${operation}: Microsoft Graph er midlertidigt utilgængelig.`,
      "UNAVAILABLE",
      true,
      response.status
    );
  }

  return new ConnectorError(
    `${operation}: Uventet Microsoft Graph-fejl.`,
    "INVALID_RESPONSE",
    false,
    response.status
  );
}

function cleanText(
  value?: string
): string | undefined {
  if (!value) return undefined;

  return [...value]
    .filter((character) => {
      const code =
        character.charCodeAt(0);

      return (
        code >= 32 ||
        code === 9 ||
        code === 10 ||
        code === 13
      );
    })
    .join("")
    .slice(0, 20_000);
}

function normalizeFractionalSeconds(
  value: string
): string {
  return value.replace(
    /\.(\d{3})\d+/,
    ".$1"
  );
}

function graphDateTimeToIso(
  value: string | undefined,
  timeZone: string | undefined
): string | undefined {
  if (!value) return undefined;

  let normalized =
    normalizeFractionalSeconds(
      value
    );

  if (
    !/[zZ]$/.test(normalized) &&
    !/[+-]\d{2}:\d{2}$/.test(
      normalized
    )
  ) {
    if (
      !timeZone ||
      timeZone.toUpperCase() ===
        "UTC"
    ) {
      normalized += "Z";
    } else {
      throw new ConnectorError(
        `Microsoft Graph returnerede lokal tid i ukendt tidszone: ${timeZone}.`,
        "INVALID_RESPONSE",
        false
      );
    }
  }

  const parsed =
    new Date(normalized);

  if (
    Number.isNaN(
      parsed.getTime()
    )
  ) {
    throw new ConnectorError(
      "Microsoft Graph returnerede ugyldig event-tid.",
      "INVALID_RESPONSE",
      false
    );
  }

  return parsed.toISOString();
}

function normalizeGraphEvent(
  event: GraphEvent
): CalendarSyncEvent {
  if (!event.id) {
    throw new ConnectorError(
      "Microsoft event mangler ID.",
      "INVALID_RESPONSE",
      false
    );
  }

  if (
    event["@removed"] ||
    event.isCancelled
  ) {
    return {
      providerEventId:
        event.id,
      providerVersion:
        event["@odata.etag"],
      title:
        event.subject?.trim() ||
        "(Slettet)",
      allDay:
        Boolean(event.isAllDay),
      recurrenceMasterId:
        event.seriesMasterId,
      recurrenceOriginalStartAt:
        event.originalStart,
      recurrenceRule:
        event.recurrence
          ? JSON.stringify(
              event.recurrence
            )
          : undefined,
      status: "CANCELLED",
      sourceUpdatedAt:
        event.lastModifiedDateTime
    };
  }

  const allDay =
    Boolean(event.isAllDay);

  if (
    !event.start?.dateTime ||
    !event.end?.dateTime
  ) {
    throw new ConnectorError(
      "Microsoft event mangler start eller slut.",
      "INVALID_RESPONSE",
      false
    );
  }

  if (allDay) {
    return {
      providerEventId:
        event.id,
      providerVersion:
        event["@odata.etag"],
      title:
        event.subject?.trim() ||
        "(Uden titel)",
      descriptionSanitized:
        cleanText(
          event.bodyPreview
        ),
      startDate:
        event.start.dateTime.slice(
          0,
          10
        ),
      endDate:
        event.end.dateTime.slice(
          0,
          10
        ),
      allDay: true,
      timezone:
        event.start.timeZone ??
        event.end.timeZone,
      recurrenceMasterId:
        event.seriesMasterId,
      recurrenceOriginalStartAt:
        event.originalStart,
      recurrenceRule:
        event.recurrence
          ? JSON.stringify(
              event.recurrence
            )
          : undefined,
      status: "CONFIRMED",
      sourceUpdatedAt:
        event.lastModifiedDateTime
    };
  }

  return {
    providerEventId:
      event.id,
    providerVersion:
      event["@odata.etag"],
    title:
      event.subject?.trim() ||
      "(Uden titel)",
    descriptionSanitized:
      cleanText(
        event.bodyPreview
      ),
    startAt:
      graphDateTimeToIso(
        event.start.dateTime,
        event.start.timeZone
      ),
    endAt:
      graphDateTimeToIso(
        event.end.dateTime,
        event.end.timeZone
      ),
    allDay: false,
    timezone:
      event.start.timeZone ??
      event.end.timeZone,
    recurrenceMasterId:
      event.seriesMasterId,
    recurrenceOriginalStartAt:
      event.originalStart,
    recurrenceRule:
      event.recurrence
        ? JSON.stringify(
            event.recurrence
          )
        : undefined,
    status: "CONFIRMED",
    sourceUpdatedAt:
      event.lastModifiedDateTime
  };
}

function headers(
  accessToken: string
): HeadersInit {
  return {
    authorization:
      `Bearer ${accessToken}`,
    accept: "application/json",
    Prefer:
      'outlook.timezone="UTC"'
  };
}

function bodyHeaders(
  accessToken: string
): HeadersInit {
  return {
    ...headers(accessToken),
    "content-type":
      "application/json"
  };
}

function assertDeltaLink(
  value: string
): URL {
  const url = new URL(value);

  if (
    url.protocol !== "https:" ||
    url.hostname !==
      "graph.microsoft.com" ||
    !url.pathname.startsWith(
      "/v1.0/me/"
    ) ||
    !url.pathname.includes(
      "/calendarView/delta"
    )
  ) {
    throw new ConnectorError(
      "Microsoft deltaLink peger ikke på den forventede Graph-resource.",
      "INVALID_RESPONSE",
      false
    );
  }

  return url;
}

function writeDateTime(
  value:
    | {
        dateTime: string;
        timeZone?: string;
      }
    | {
        date: string;
      }
) {
  if ("date" in value) {
    return {
      dateTime:
        `${value.date}T00:00:00`,
      timeZone: "UTC"
    };
  }

  return {
    dateTime:
      value.dateTime,
    timeZone:
      value.timeZone ??
      "UTC"
  };
}

function eventBody(
  event:
    | CalendarEventWrite
    | CalendarEventPatch
) {
  const body:
    Record<string, unknown> = {};

  if (
    "title" in event &&
    event.title !== undefined
  ) {
    body.subject =
      event.title;
  }

  if (
    "description" in event &&
    event.description !== undefined
  ) {
    body.body = {
      contentType: "text",
      content:
        event.description
    };
  }

  if (event.start) {
    body.start =
      writeDateTime(
        event.start
      );
  }

  if (event.end) {
    body.end =
      writeDateTime(
        event.end
      );
  }

  if (
    event.start &&
    "date" in event.start
  ) {
    body.isAllDay = true;
  }

  return body;
}

export class MicrosoftCalendarConnector
  implements CalendarConnector
{
  readonly provider =
    "MICROSOFT" as const;

  constructor(
    private readonly fetchImpl:
      typeof fetch = fetch
  ) {}

  async initialSync(
    input:
      InitialCalendarSyncInput
  ): Promise<CalendarSyncResult> {
    if (
      !input.timeMin ||
      !input.timeMax
    ) {
      throw new ConnectorError(
        "Microsoft calendarView/delta kræver et fast start- og slutvindue.",
        "INVALID_RESPONSE",
        false
      );
    }

    const url = new URL(
      `${GRAPH_BASE}/me/calendars/${encodeURIComponent(input.calendarId)}/calendarView/delta`
    );

    url.searchParams.set(
      "startDateTime",
      input.timeMin
    );
    url.searchParams.set(
      "endDateTime",
      input.timeMax
    );

    return this.syncPages(
      input.accessToken,
      url
    );
  }

  async incrementalSync(
    input:
      IncrementalCalendarSyncInput
  ): Promise<CalendarSyncResult> {
    if (
      input.cursor.type !==
      "MICROSOFT_DELTA_LINK"
    ) {
      throw new ConnectorError(
        "Microsoft connector modtog en cursor fra en anden provider.",
        "INVALID_RESPONSE",
        false
      );
    }

    return this.syncPages(
      input.accessToken,
      assertDeltaLink(
        input.cursor.value
      )
    );
  }

  private async syncPages(
    accessToken: string,
    initialUrl: URL
  ): Promise<CalendarSyncResult> {
    const events:
      CalendarSyncEvent[] = [];

    let nextUrl:
      | URL
      | undefined =
      initialUrl;
    let deltaLink:
      | string
      | undefined;

    while (nextUrl) {
      const response =
        await this.fetchImpl(
          nextUrl,
          {
            method: "GET",
            headers:
              headers(
                accessToken
              )
          }
        );

      if (!response.ok) {
        throw graphError(
          response,
          "calendarView.delta"
        );
      }

      const page =
        (await response.json()) as
          GraphDeltaPage;

      for (
        const event of
        page.value ?? []
      ) {
        events.push(
          normalizeGraphEvent(
            event
          )
        );
      }

      if (
        page["@odata.nextLink"]
      ) {
        nextUrl =
          assertDeltaLink(
            page[
              "@odata.nextLink"
            ]!
          );
        continue;
      }

      nextUrl = undefined;
      deltaLink =
        page[
          "@odata.deltaLink"
        ];
    }

    if (!deltaLink) {
      throw new ConnectorError(
        "Microsoft Graph returnerede ikke @odata.deltaLink på sidste side.",
        "INVALID_RESPONSE",
        false
      );
    }

    assertDeltaLink(deltaLink);

    return {
      events,
      cursor: {
        type:
          "MICROSOFT_DELTA_LINK",
        value:
          deltaLink
      },
      fullResyncRequired:
        false
    };
  }

  async getEvent(
    input:
      GetCalendarEventInput
  ): Promise<CalendarSyncEvent> {
    const response =
      await this.fetchImpl(
        `${GRAPH_BASE}/me/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
        {
          method: "GET",
          headers:
            headers(
              input.accessToken
            )
        }
      );

    if (!response.ok) {
      throw graphError(
        response,
        "calendar.events.get"
      );
    }

    return normalizeGraphEvent(
      (await response.json()) as
        GraphEvent
    );
  }

  async listEventInstances(
    input:
      ListCalendarEventInstancesInput
  ): Promise<CalendarSyncEvent[]> {
    const url = new URL(
      `${GRAPH_BASE}/me/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}/instances`
    );

    if (input.timeMin) {
      url.searchParams.set(
        "startDateTime",
        input.timeMin
      );
    }

    if (input.timeMax) {
      url.searchParams.set(
        "endDateTime",
        input.timeMax
      );
    }

    const response =
      await this.fetchImpl(
        url,
        {
          method: "GET",
          headers:
            headers(
              input.accessToken
            )
        }
      );

    if (!response.ok) {
      throw graphError(
        response,
        "calendar.events.instances"
      );
    }

    const body =
      (await response.json()) as {
        value?: GraphEvent[];
      };

    return (
      body.value ?? []
    ).map(
      normalizeGraphEvent
    );
  }

  private async assertVersion(
    input: {
      accessToken: string;
      calendarId: string;
      eventId: string;
      providerVersion?: string;
    }
  ): Promise<void> {
    if (!input.providerVersion) {
      return;
    }

    const response =
      await this.fetchImpl(
        `${GRAPH_BASE}/me/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
        {
          method: "GET",
          headers:
            headers(
              input.accessToken
            )
        }
      );

    if (!response.ok) {
      throw graphError(
        response,
        "calendar.events.version"
      );
    }

    const event =
      (await response.json()) as
        GraphEvent;

    if (
      event["@odata.etag"] !==
      input.providerVersion
    ) {
      throw new ConnectorError(
        "Microsoft-eventen er ændret siden sidste synkronisering.",
        "CONFLICT",
        false,
        409
      );
    }
  }

  async createEvent(
    input:
      CreateCalendarEventInput
  ): Promise<CalendarSyncEvent> {
    const response =
      await this.fetchImpl(
        `${GRAPH_BASE}/me/calendars/${encodeURIComponent(input.calendarId)}/events`,
        {
          method: "POST",
          headers:
            bodyHeaders(
              input.accessToken
            ),
          body:
            JSON.stringify(
              eventBody(
                input.event
              )
            )
        }
      );

    if (!response.ok) {
      throw graphError(
        response,
        "calendar.events.create"
      );
    }

    return normalizeGraphEvent(
      (await response.json()) as
        GraphEvent
    );
  }

  async updateEvent(
    input:
      UpdateCalendarEventInput
  ): Promise<CalendarSyncEvent> {
    await this.assertVersion(
      input
    );

    const response =
      await this.fetchImpl(
        `${GRAPH_BASE}/me/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
        {
          method: "PATCH",
          headers:
            bodyHeaders(
              input.accessToken
            ),
          body:
            JSON.stringify(
              eventBody(
                input.event
              )
            )
        }
      );

    if (!response.ok) {
      throw graphError(
        response,
        "calendar.events.update"
      );
    }

    return normalizeGraphEvent(
      (await response.json()) as
        GraphEvent
    );
  }

  async deleteEvent(
    input:
      DeleteCalendarEventInput
  ): Promise<void> {
    await this.assertVersion(
      input
    );

    const response =
      await this.fetchImpl(
        `${GRAPH_BASE}/me/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
        {
          method: "DELETE",
          headers:
            headers(
              input.accessToken
            )
        }
      );

    if (
      !response.ok &&
      response.status !== 404
    ) {
      throw graphError(
        response,
        "calendar.events.delete"
      );
    }
  }
}
