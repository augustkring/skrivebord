import { describe, expect, it, vi } from "vitest";
import {
  ConnectorError,
  GoogleCalendarConnector
} from "./index";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

describe("GoogleCalendarConnector", () => {
  it("paginates initial sync and stores nextSyncToken from the final page", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "event-1",
              etag: "v1",
              summary: "Rengøring",
              start: {
                dateTime: "2026-09-24T10:00:00+02:00",
                timeZone: "Europe/Copenhagen"
              },
              end: {
                dateTime: "2026-09-24T12:00:00+02:00",
                timeZone: "Europe/Copenhagen"
              },
              updated: "2026-09-22T08:00:00Z"
            }
          ],
          nextPageToken: "page-2"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "series-1",
              etag: "v2",
              summary: "Ugentligt eftersyn",
              start: {
                dateTime: "2026-09-25T09:00:00+02:00",
                timeZone: "Europe/Copenhagen"
              },
              end: {
                dateTime: "2026-09-25T10:00:00+02:00",
                timeZone: "Europe/Copenhagen"
              },
              recurrence: ["RRULE:FREQ=WEEKLY"],
              updated: "2026-09-22T09:00:00Z"
            }
          ],
          nextSyncToken: "sync-final"
        })
      );

    const connector = new GoogleCalendarConnector(fetchMock);
    const result = await connector.initialSync({
      accessToken: "token",
      calendarId: "primary",
      timeMin: "2026-06-01T00:00:00Z",
      timeMax: "2028-03-01T00:00:00Z"
    });

    expect(result.fullResyncRequired).toBe(false);
    expect(result.cursor).toEqual({
      type: "GOOGLE_SYNC_TOKEN",
      value: "sync-final"
    });
    expect(result.events).toHaveLength(2);
    expect(result.events[1]?.recurrenceRule).toBe(
      "RRULE:FREQ=WEEKLY"
    );

    const secondUrl = new URL(
      String(fetchMock.mock.calls[1]?.[0])
    );
    expect(secondUrl.searchParams.get("pageToken")).toBe("page-2");
    expect(secondUrl.searchParams.get("singleEvents")).toBe("false");
  });

  it("preserves all-day date semantics without inventing UTC timestamps", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        items: [
          {
            id: "all-day",
            summary: "Lukket",
            start: { date: "2026-12-24" },
            end: { date: "2026-12-25" }
          }
        ],
        nextSyncToken: "sync"
      })
    );

    const connector = new GoogleCalendarConnector(fetchMock);
    const result = await connector.initialSync({
      accessToken: "token",
      calendarId: "primary"
    });

    expect(result.events[0]).toMatchObject({
      allDay: true,
      startDate: "2026-12-24",
      endDate: "2026-12-25"
    });
    expect(result.events[0]?.startAt).toBeUndefined();
  });

  it("signals full resync instead of treating a 410 sync token as a generic failure", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 410 })
    );

    const connector = new GoogleCalendarConnector(fetchMock);
    const result = await connector.incrementalSync({
      accessToken: "token",
      calendarId: "primary",
      cursor: {
        type: "GOOGLE_SYNC_TOKEN",
        value: "expired-token"
      }
    });

    expect(result).toEqual({
      events: [],
      fullResyncRequired: true
    });
  });

  it("uses If-Match for concurrency-protected updates", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: "event-1",
        etag: "v2",
        summary: "Flyttet rengøring",
        start: {
          dateTime: "2026-09-25T09:00:00+02:00"
        },
        end: {
          dateTime: "2026-09-25T11:00:00+02:00"
        }
      })
    );

    const connector = new GoogleCalendarConnector(fetchMock);
    await connector.updateEvent({
      accessToken: "token",
      calendarId: "primary",
      eventId: "event-1",
      providerVersion: "v1",
      event: {
        title: "Flyttet rengøring",
        start: {
          dateTime: "2026-09-25T09:00:00+02:00"
        },
        end: {
          dateTime: "2026-09-25T11:00:00+02:00"
        }
      }
    });

    const request = fetchMock.mock.calls[0];
    const init = request?.[1];
    expect(new Headers(init?.headers).get("if-match")).toBe("v1");
    expect(init?.method).toBe("PATCH");
  });


  it("sends a minimal PATCH when only event timing changes", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: "event-2",
        etag: "v3",
        summary: "Bevar titel",
        description: "Bevar beskrivelse",
        start: {
          dateTime: "2026-09-26T10:00:00+02:00",
          timeZone: "Europe/Copenhagen"
        },
        end: {
          dateTime: "2026-09-26T11:00:00+02:00",
          timeZone: "Europe/Copenhagen"
        }
      })
    );

    const connector = new GoogleCalendarConnector(fetchMock);

    await connector.updateEvent({
      accessToken: "token",
      calendarId: "primary",
      eventId: "event-2",
      providerVersion: "v2",
      event: {
        start: {
          dateTime: "2026-09-26T10:00:00+02:00",
          timeZone: "Europe/Copenhagen"
        },
        end: {
          dateTime: "2026-09-26T11:00:00+02:00",
          timeZone: "Europe/Copenhagen"
        }
      }
    });

    const body = JSON.parse(
      String(
        fetchMock.mock.calls[0]?.[1]?.body
      )
    ) as Record<string, unknown>;

    expect(body).toEqual({
      start: {
        dateTime: "2026-09-26T10:00:00+02:00",
        timeZone: "Europe/Copenhagen"
      },
      end: {
        dateTime: "2026-09-26T11:00:00+02:00",
        timeZone: "Europe/Copenhagen"
      }
    });
    expect(body).not.toHaveProperty("summary");
    expect(body).not.toHaveProperty("description");
    expect(body).not.toHaveProperty("recurrence");
  });

  it("classifies provider rate limits as retryable", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 429 })
    );

    const connector = new GoogleCalendarConnector(fetchMock);

    await expect(
      connector.initialSync({
        accessToken: "token",
        calendarId: "primary"
      })
    ).rejects.toMatchObject<Partial<ConnectorError>>({
      code: "RATE_LIMITED",
      retryable: true,
      status: 429
    });
  });
});
