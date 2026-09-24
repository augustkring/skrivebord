import { describe, expect, it, vi } from "vitest";
import {
  ConnectorError,
  MicrosoftCalendarConnector
} from "./index";

function jsonResponse(
  body: unknown,
  status = 200
): Response {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        "content-type":
          "application/json"
      }
    }
  );
}

describe("MicrosoftCalendarConnector", () => {
  it("follows opaque nextLink pages and persists the final deltaLink", async () => {
    const fetchMock =
      vi.fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonResponse({
            value: [
              {
                id: "event-1",
                "@odata.etag": "etag-1",
                subject: "Rengøring",
                start: {
                  dateTime:
                    "2026-09-24T08:00:00.0000000",
                  timeZone: "UTC"
                },
                end: {
                  dateTime:
                    "2026-09-24T10:00:00.0000000",
                  timeZone: "UTC"
                },
                isAllDay: false,
                lastModifiedDateTime:
                  "2026-09-23T10:00:00Z"
              }
            ],
            "@odata.nextLink":
              "https://graph.microsoft.com/v1.0/me/calendars/cal-1/calendarView/delta?$skiptoken=next"
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            value: [
              {
                id: "event-2",
                "@removed": {
                  reason: "deleted"
                }
              }
            ],
            "@odata.deltaLink":
              "https://graph.microsoft.com/v1.0/me/calendars/cal-1/calendarView/delta?$deltatoken=final"
          })
        );

    const connector =
      new MicrosoftCalendarConnector(
        fetchMock
      );

    const result =
      await connector.initialSync({
        accessToken: "token",
        calendarId: "cal-1",
        timeMin:
          "2026-06-01T00:00:00Z",
        timeMax:
          "2028-03-01T00:00:00Z"
      });

    expect(
      result.cursor
    ).toEqual({
      type:
        "MICROSOFT_DELTA_LINK",
      value:
        "https://graph.microsoft.com/v1.0/me/calendars/cal-1/calendarView/delta?$deltatoken=final"
    });

    expect(
      result.events[0]
    ).toMatchObject({
      providerEventId:
        "event-1",
      providerVersion:
        "etag-1",
      startAt:
        "2026-09-24T08:00:00.000Z",
      endAt:
        "2026-09-24T10:00:00.000Z",
      status: "CONFIRMED"
    });

    expect(
      result.events[1]
    ).toMatchObject({
      providerEventId:
        "event-2",
      status: "CANCELLED"
    });

    expect(
      String(
        fetchMock.mock.calls[1]?.[0]
      )
    ).toContain(
      "$skiptoken=next"
    );
  });

  it("rejects deltaLinks outside the expected Microsoft Graph v1.0 /me resource", async () => {
    const connector =
      new MicrosoftCalendarConnector(
        vi.fn<typeof fetch>()
      );

    await expect(
      connector.incrementalSync({
        accessToken: "token",
        calendarId: "cal-1",
        cursor: {
          type:
            "MICROSOFT_DELTA_LINK",
          value:
            "https://evil.example/v1.0/me/calendarView/delta?$deltatoken=x"
        }
      })
    ).rejects.toMatchObject<
      Partial<ConnectorError>
    >({
      code:
        "INVALID_RESPONSE",
      retryable: false
    });
  });

  it("normalizes recurring occurrence metadata including originalStart", async () => {
    const fetchMock =
      vi.fn<typeof fetch>()
        .mockResolvedValue(
          jsonResponse({
            value: [
              {
                id:
                  "occurrence-1",
                "@odata.etag":
                  "etag-occ",
                subject:
                  "Ugentligt eftersyn",
                start: {
                  dateTime:
                    "2026-10-02T09:00:00",
                  timeZone: "UTC"
                },
                end: {
                  dateTime:
                    "2026-10-02T10:00:00",
                  timeZone: "UTC"
                },
                isAllDay: false,
                seriesMasterId:
                  "series-1",
                originalStart:
                  "2026-10-02T08:00:00Z"
              }
            ],
            "@odata.deltaLink":
              "https://graph.microsoft.com/v1.0/me/calendars/cal-1/calendarView/delta?$deltatoken=done"
          })
        );

    const connector =
      new MicrosoftCalendarConnector(
        fetchMock
      );

    const result =
      await connector.initialSync({
        accessToken: "token",
        calendarId: "cal-1",
        timeMin:
          "2026-09-01T00:00:00Z",
        timeMax:
          "2026-12-01T00:00:00Z"
      });

    expect(
      result.events[0]
    ).toMatchObject({
      recurrenceMasterId:
        "series-1",
      recurrenceOriginalStartAt:
        "2026-10-02T08:00:00Z"
    });
  });

  it("detects stale event state before PATCH", async () => {
    const fetchMock =
      vi.fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonResponse({
            id: "event-1",
            "@odata.etag":
              "new-etag",
            subject: "Current",
            start: {
              dateTime:
                "2026-09-24T08:00:00",
              timeZone: "UTC"
            },
            end: {
              dateTime:
                "2026-09-24T09:00:00",
              timeZone: "UTC"
            },
            isAllDay: false
          })
        );

    const connector =
      new MicrosoftCalendarConnector(
        fetchMock
      );

    await expect(
      connector.updateEvent({
        accessToken: "token",
        calendarId: "cal-1",
        eventId: "event-1",
        providerVersion:
          "old-etag",
        event: {
          start: {
            dateTime:
              "2026-09-24T10:00:00Z",
            timeZone: "UTC"
          },
          end: {
            dateTime:
              "2026-09-24T11:00:00Z",
            timeZone: "UTC"
          }
        }
      })
    ).rejects.toMatchObject<
      Partial<ConnectorError>
    >({
      code: "CONFLICT",
      retryable: false
    });

    expect(
      fetchMock
    ).toHaveBeenCalledTimes(1);
  });

  it("classifies Graph throttling as retryable", async () => {
    const fetchMock =
      vi.fn<typeof fetch>()
        .mockResolvedValue(
          new Response(null, {
            status: 429
          })
        );

    const connector =
      new MicrosoftCalendarConnector(
        fetchMock
      );

    await expect(
      connector.initialSync({
        accessToken: "token",
        calendarId: "cal-1",
        timeMin:
          "2026-09-01T00:00:00Z",
        timeMax:
          "2026-12-01T00:00:00Z"
      })
    ).rejects.toMatchObject<
      Partial<ConnectorError>
    >({
      code: "RATE_LIMITED",
      retryable: true,
      status: 429
    });
  });
});
