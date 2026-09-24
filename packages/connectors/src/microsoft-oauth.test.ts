import { describe, expect, it, vi } from "vitest";
import {
  buildMicrosoftAuthorizationUrl,
  createMicrosoftPkce,
  exchangeMicrosoftAuthorizationCode,
  fetchMicrosoftAccountIdentity,
  listMicrosoftCalendars,
  refreshMicrosoftAccessToken
} from "./microsoft-oauth";

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

describe("Microsoft OAuth", () => {
  it("builds PKCE S256 authorization with offline Graph scopes", () => {
    const pkce =
      createMicrosoftPkce();

    expect(
      pkce.verifier.length
    ).toBeGreaterThan(40);
    expect(
      pkce.challenge
    ).not.toBe(
      pkce.verifier
    );

    const url = new URL(
      buildMicrosoftAuthorizationUrl({
        tenant: "common",
        clientId: "client",
        redirectUri:
          "https://example.com/callback",
        state: "state-token",
        codeChallenge:
          pkce.challenge
      })
    );

    expect(
      url.origin + url.pathname
    ).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
    );
    expect(
      url.searchParams.get(
        "code_challenge_method"
      )
    ).toBe("S256");
    expect(
      url.searchParams.get(
        "state"
      )
    ).toBe("state-token");

    const scopes =
      url.searchParams
        .get("scope")
        ?.split(" ") ?? [];

    expect(scopes).toContain(
      "offline_access"
    );
    expect(scopes).toContain(
      "https://graph.microsoft.com/Calendars.ReadWrite"
    );
  });

  it("exchanges and refreshes tokens while retaining a refresh token", async () => {
    const fetchMock =
      vi.fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonResponse({
            access_token:
              "access-1",
            refresh_token:
              "refresh-1",
            expires_in: 3600,
            scope:
              "openid offline_access https://graph.microsoft.com/Calendars.ReadWrite",
            token_type:
              "Bearer"
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            access_token:
              "access-2",
            expires_in: 3600,
            scope:
              "openid offline_access https://graph.microsoft.com/Calendars.ReadWrite",
            token_type:
              "Bearer"
          })
        );

    const first =
      await exchangeMicrosoftAuthorizationCode({
        clientId: "client",
        clientSecret: "secret",
        redirectUri:
          "https://example.com/callback",
        code: "code",
        codeVerifier:
          "verifier-value",
        fetchImpl:
          fetchMock,
        now:
          new Date(
            "2026-09-24T10:00:00Z"
          )
      });

    const second =
      await refreshMicrosoftAccessToken({
        clientId: "client",
        clientSecret: "secret",
        refreshToken:
          first.refreshToken!,
        fetchImpl:
          fetchMock,
        now:
          new Date(
            "2026-09-24T11:00:00Z"
          )
      });

    expect(
      first.refreshToken
    ).toBe("refresh-1");
    expect(
      second.refreshToken
    ).toBe("refresh-1");
    expect(
      second.accessToken
    ).toBe("access-2");
  });

  it("gets stable account identity and paginated calendars", async () => {
    const fetchMock =
      vi.fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonResponse({
            id: "user-1",
            displayName:
              "Lene",
            mail:
              "lene@example.com"
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            value: [
              {
                id: "cal-1",
                name: "Calendar",
                isDefaultCalendar:
                  true,
                canEdit: true,
                owner: {
                  address:
                    "lene@example.com"
                }
              }
            ],
            "@odata.nextLink":
              "https://graph.microsoft.com/v1.0/me/calendars?$skiptoken=next"
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            value: [
              {
                id: "cal-2",
                name: "Read only",
                isDefaultCalendar:
                  false,
                canEdit:
                  false
              }
            ]
          })
        );

    const identity =
      await fetchMicrosoftAccountIdentity({
        accessToken: "token",
        fetchImpl:
          fetchMock
      });

    const calendars =
      await listMicrosoftCalendars({
        accessToken: "token",
        fetchImpl:
          fetchMock
      });

    expect(identity).toEqual({
      id: "user-1",
      displayName:
        "Lene",
      email:
        "lene@example.com"
    });

    expect(calendars).toEqual([
      {
        id: "cal-1",
        name: "Calendar",
        primary: true,
        writable: true,
        ownerAddress:
          "lene@example.com"
      },
      {
        id: "cal-2",
        name: "Read only",
        primary: false,
        writable: false,
        ownerAddress:
          undefined
      }
    ]);
  });

  it("rejects Microsoft calendar pagination links outside Graph", async () => {
    const fetchMock =
      vi.fn<typeof fetch>()
        .mockResolvedValue(
          jsonResponse({
            value: [],
            "@odata.nextLink":
              "https://evil.example/v1.0/me/calendars?$skiptoken=x"
          })
        );

    await expect(
      listMicrosoftCalendars({
        accessToken: "token",
        fetchImpl:
          fetchMock
      })
    ).rejects.toMatchObject({
      code:
        "INVALID_RESPONSE"
    });
  });
});
