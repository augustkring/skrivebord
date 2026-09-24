import { describe, expect, it, vi } from "vitest";
import {
  buildGoogleAuthorizationUrl,
  exchangeGoogleAuthorizationCode,
  fetchGoogleAccountIdentity,
  googleCalendarAccessRoleWritable,
  listGoogleCalendars,
  refreshGoogleAccessToken
} from "./google-oauth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

describe("Google OAuth", () => {
  it("builds an offline consent URL with least-privilege calendar scopes", () => {
    const url = new URL(
      buildGoogleAuthorizationUrl({
        clientId: "client",
        redirectUri: "https://example.com/callback",
        state: "state-token"
      })
    );

    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("state-token");

    const scopes = url.searchParams.get("scope")?.split(" ") ?? [];
    expect(scopes).toContain(
      "https://www.googleapis.com/auth/calendar.events"
    );
    expect(scopes).toContain(
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
    );
    expect(scopes).not.toContain(
      "https://www.googleapis.com/auth/calendar"
    );
  });

  it("exchanges and refreshes OAuth tokens without losing the refresh token", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 3600,
          scope: "openid email",
          token_type: "Bearer"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "access-2",
          expires_in: 3600,
          scope: "openid email",
          token_type: "Bearer"
        })
      );

    const first = await exchangeGoogleAuthorizationCode({
      clientId: "client",
      clientSecret: "secret",
      redirectUri: "https://example.com/callback",
      code: "code",
      fetchImpl: fetchMock,
      now: new Date("2026-09-22T10:00:00Z")
    });

    const second = await refreshGoogleAccessToken({
      clientId: "client",
      clientSecret: "secret",
      refreshToken: first.refreshToken!,
      fetchImpl: fetchMock,
      now: new Date("2026-09-22T11:00:00Z")
    });

    expect(first.refreshToken).toBe("refresh-1");
    expect(second.refreshToken).toBe("refresh-1");
    expect(second.accessToken).toBe("access-2");
  });

  it("fetches stable Google account identity from userinfo", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        sub: "google-sub-123",
        email: "lene@example.com",
        email_verified: true
      })
    );

    const identity = await fetchGoogleAccountIdentity({
      accessToken: "token",
      fetchImpl: fetchMock
    });

    expect(identity).toEqual({
      subject: "google-sub-123",
      email: "lene@example.com",
      emailVerified: true
    });
  });

  it("paginates calendar discovery and recognizes the 2026 writerWithoutPrivateAccess role", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "primary@example.com",
              summary: "Primary",
              primary: true,
              accessRole: "owner",
              timeZone: "Europe/Copenhagen"
            }
          ],
          nextPageToken: "page-2"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "ops@example.com",
              summary: "Operations",
              accessRole: "writerWithoutPrivateAccess",
              timeZone: "Europe/Copenhagen"
            }
          ]
        })
      );

    const calendars = await listGoogleCalendars({
      accessToken: "token",
      fetchImpl: fetchMock
    });

    expect(calendars).toHaveLength(2);
    expect(calendars[0]?.primary).toBe(true);
    expect(
      googleCalendarAccessRoleWritable(
        calendars[1]?.accessRole ?? ""
      )
    ).toBe(true);

    const secondUrl = new URL(
      String(fetchMock.mock.calls[1]?.[0])
    );
    expect(secondUrl.searchParams.get("pageToken")).toBe("page-2");
    expect(secondUrl.searchParams.get("maxResults")).toBe("250");
  });
});
