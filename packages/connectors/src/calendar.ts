export type ConnectorProvider = "GOOGLE" | "MICROSOFT";

export type CalendarSyncCursor =
  | {
      type: "GOOGLE_SYNC_TOKEN";
      value: string;
    }
  | {
      type: "MICROSOFT_DELTA_LINK";
      value: string;
    };

export type CalendarSyncEvent = {
  providerEventId: string;
  providerVersion?: string;
  title: string;
  descriptionSanitized?: string;
  startAt?: string;
  endAt?: string;
  startDate?: string;
  endDate?: string;
  allDay: boolean;
  timezone?: string;
  recurrenceMasterId?: string;
  recurrenceRule?: string;
  status: "CONFIRMED" | "CANCELLED";
  sourceUpdatedAt?: string;
};

export type CalendarSyncResult = {
  events: CalendarSyncEvent[];
  cursor?: CalendarSyncCursor;
  fullResyncRequired: boolean;
};

export type InitialCalendarSyncInput = {
  accessToken: string;
  calendarId: string;
  timeMin?: string;
  timeMax?: string;
};

export type IncrementalCalendarSyncInput = {
  accessToken: string;
  calendarId: string;
  cursor: CalendarSyncCursor;
};

export type CalendarEventWrite = {
  title: string;
  description?: string;
  start:
    | { dateTime: string; timeZone?: string }
    | { date: string };
  end:
    | { dateTime: string; timeZone?: string }
    | { date: string };
  recurrence?: string[];
};

export type CalendarEventPatch = {
  title?: string;
  description?: string;
  start?:
    | { dateTime: string; timeZone?: string }
    | { date: string };
  end?:
    | { dateTime: string; timeZone?: string }
    | { date: string };
  recurrence?: string[];
};

export type UpdateCalendarEventInput = {
  accessToken: string;
  calendarId: string;
  eventId: string;
  providerVersion?: string;
  event: CalendarEventPatch;
};

export type CreateCalendarEventInput = {
  accessToken: string;
  calendarId: string;
  event: CalendarEventWrite;
};

export type DeleteCalendarEventInput = {
  accessToken: string;
  calendarId: string;
  eventId: string;
  providerVersion?: string;
};

export interface CalendarConnector {
  provider: ConnectorProvider;

  initialSync(
    input: InitialCalendarSyncInput
  ): Promise<CalendarSyncResult>;

  incrementalSync(
    input: IncrementalCalendarSyncInput
  ): Promise<CalendarSyncResult>;

  createEvent(
    input: CreateCalendarEventInput
  ): Promise<CalendarSyncEvent>;

  updateEvent(
    input: UpdateCalendarEventInput
  ): Promise<CalendarSyncEvent>;

  deleteEvent(
    input: DeleteCalendarEventInput
  ): Promise<void>;
}

export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly code:
      | "AUTH_EXPIRED"
      | "RATE_LIMITED"
      | "UNAVAILABLE"
      | "CONFLICT"
      | "INVALID_RESPONSE",
    readonly retryable: boolean,
    readonly status?: number
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}
