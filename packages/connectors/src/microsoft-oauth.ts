import {
  createHash,
  randomBytes
} from "node:crypto";
import {
  ConnectorError
} from "./calendar";

const GRAPH_BASE =
  "https://graph.microsoft.com/v1.0";

export const MICROSOFT_GRAPH_SCOPES = [
  "openid",
  "email",
  "offline_access",
  "https://graph.microsoft.com/User.Read",
  "https://graph.microsoft.com/Calendars.ReadWrite"
] as const;

export type MicrosoftPkce = {
  verifier: string;
  challenge: string;
};

export type MicrosoftOAuthTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  tokenType?: string;
  scope: string[];
  idToken?: string;
};

export type MicrosoftAccountIdentity = {
  id: string;
  displayName?: string;
  email: string;
};

export type MicrosoftCalendarListEntry = {
  id: string;
  name: string;
  primary: boolean;
  writable: boolean;
  ownerAddress?: string;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

type MeResponse = {
  id?: string;
  displayName?: string;
  mail?: string | null;
  userPrincipalName?: string;
};

type CalendarListPage = {
  value?: Array<{
    id?: string;
    name?: string;
    isDefaultCalendar?: boolean;
    canEdit?: boolean;
    owner?: {
      address?: string;
    };
  }>;
  "@odata.nextLink"?: string;
};

function identityBase(
  tenant: string
): string {
  const normalized =
    tenant.trim() || "common";

  if (
    !/^[A-Za-z0-9.-]+$/.test(
      normalized
    )
  ) {
    throw new Error(
      "INVALID_MICROSOFT_TENANT"
    );
  }

  return `https://login.microsoftonline.com/${normalized}/oauth2/v2.0`;
}

function providerError(
  response: Response,
  operation: string
): ConnectorError {
  if (
    response.status === 400 ||
    response.status === 401 ||
    response.status === 403
  ) {
    return new ConnectorError(
      `${operation}: Microsoft authorization blev afvist.`,
      "AUTH_EXPIRED",
      false,
      response.status
    );
  }

  if (response.status === 429) {
    return new ConnectorError(
      `${operation}: Microsoft rate limit.`,
      "RATE_LIMITED",
      true,
      response.status
    );
  }

  if (response.status >= 500) {
    return new ConnectorError(
      `${operation}: Microsoft er midlertidigt utilgængelig.`,
      "UNAVAILABLE",
      true,
      response.status
    );
  }

  return new ConnectorError(
    `${operation}: Uventet Microsoft-fejl.`,
    "INVALID_RESPONSE",
    false,
    response.status
  );
}

function normalizeTokens(
  body: TokenResponse,
  now: Date,
  existingRefreshToken?: string
): MicrosoftOAuthTokens {
  if (!body.access_token) {
    throw new ConnectorError(
      body.error_description ??
        "Microsoft returnerede intet access token.",
      "INVALID_RESPONSE",
      false
    );
  }

  return {
    accessToken:
      body.access_token,
    refreshToken:
      body.refresh_token ??
      existingRefreshToken,
    expiresAt:
      body.expires_in
        ? new Date(
            now.getTime() +
              body.expires_in *
                1000
          ).toISOString()
        : undefined,
    tokenType:
      body.token_type,
    scope:
      body.scope
        ?.split(" ")
        .filter(Boolean) ??
      [],
    idToken:
      body.id_token
  };
}

function assertGraphNextLink(
  value: string
): URL {
  const url = new URL(value);

  if (
    url.protocol !== "https:" ||
    url.hostname !==
      "graph.microsoft.com" ||
    !url.pathname.startsWith(
      "/v1.0/me/calendars"
    )
  ) {
    throw new ConnectorError(
      "Microsoft pagination-link peger ikke på den forventede Graph-resource.",
      "INVALID_RESPONSE",
      false
    );
  }

  return url;
}

export function createMicrosoftPkce(): MicrosoftPkce {
  const verifier =
    randomBytes(48)
      .toString("base64url");

  const challenge =
    createHash("sha256")
      .update(verifier)
      .digest("base64url");

  return {
    verifier,
    challenge
  };
}

export function buildMicrosoftAuthorizationUrl(input: {
  tenant?: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(
    `${identityBase(input.tenant ?? "common")}/authorize`
  );

  url.searchParams.set(
    "client_id",
    input.clientId
  );
  url.searchParams.set(
    "response_type",
    "code"
  );
  url.searchParams.set(
    "redirect_uri",
    input.redirectUri
  );
  url.searchParams.set(
    "response_mode",
    "query"
  );
  url.searchParams.set(
    "scope",
    MICROSOFT_GRAPH_SCOPES.join(
      " "
    )
  );
  url.searchParams.set(
    "state",
    input.state
  );
  url.searchParams.set(
    "code_challenge",
    input.codeChallenge
  );
  url.searchParams.set(
    "code_challenge_method",
    "S256"
  );

  return url.toString();
}

export async function exchangeMicrosoftAuthorizationCode(input: {
  tenant?: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<MicrosoftOAuthTokens> {
  const fetchImpl =
    input.fetchImpl ?? fetch;

  const response =
    await fetchImpl(
      `${identityBase(input.tenant ?? "common")}/token`,
      {
        method: "POST",
        headers: {
          "content-type":
            "application/x-www-form-urlencoded",
          accept:
            "application/json"
        },
        body:
          new URLSearchParams({
            client_id:
              input.clientId,
            client_secret:
              input.clientSecret,
            grant_type:
              "authorization_code",
            code:
              input.code,
            redirect_uri:
              input.redirectUri,
            code_verifier:
              input.codeVerifier,
            scope:
              MICROSOFT_GRAPH_SCOPES.join(
                " "
              )
          })
      }
    );

  if (!response.ok) {
    throw providerError(
      response,
      "oauth.code_exchange"
    );
  }

  return normalizeTokens(
    (await response.json()) as
      TokenResponse,
    input.now ?? new Date()
  );
}

export async function refreshMicrosoftAccessToken(input: {
  tenant?: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<MicrosoftOAuthTokens> {
  const fetchImpl =
    input.fetchImpl ?? fetch;

  const response =
    await fetchImpl(
      `${identityBase(input.tenant ?? "common")}/token`,
      {
        method: "POST",
        headers: {
          "content-type":
            "application/x-www-form-urlencoded",
          accept:
            "application/json"
        },
        body:
          new URLSearchParams({
            client_id:
              input.clientId,
            client_secret:
              input.clientSecret,
            grant_type:
              "refresh_token",
            refresh_token:
              input.refreshToken,
            scope:
              MICROSOFT_GRAPH_SCOPES.join(
                " "
              )
          })
      }
    );

  if (!response.ok) {
    throw providerError(
      response,
      "oauth.refresh"
    );
  }

  return normalizeTokens(
    (await response.json()) as
      TokenResponse,
    input.now ?? new Date(),
    input.refreshToken
  );
}

export async function fetchMicrosoftAccountIdentity(input: {
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<MicrosoftAccountIdentity> {
  const fetchImpl =
    input.fetchImpl ?? fetch;

  const url = new URL(
    `${GRAPH_BASE}/me`
  );
  url.searchParams.set(
    "$select",
    "id,displayName,mail,userPrincipalName"
  );

  const response =
    await fetchImpl(
      url,
      {
        method: "GET",
        headers: {
          authorization:
            `Bearer ${input.accessToken}`,
          accept:
            "application/json"
        }
      }
    );

  if (!response.ok) {
    throw providerError(
      response,
      "graph.me"
    );
  }

  const body =
    (await response.json()) as
      MeResponse;

  const email =
    body.mail ??
    body.userPrincipalName;

  if (!body.id || !email) {
    throw new ConnectorError(
      "Microsoft-profilen manglede ID eller e-mail.",
      "INVALID_RESPONSE",
      false
    );
  }

  return {
    id: body.id,
    displayName:
      body.displayName,
    email
  };
}

export async function listMicrosoftCalendars(input: {
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<MicrosoftCalendarListEntry[]> {
  const fetchImpl =
    input.fetchImpl ?? fetch;

  const entries:
    MicrosoftCalendarListEntry[] =
    [];

  let nextUrl:
    | URL
    | undefined =
    new URL(
      `${GRAPH_BASE}/me/calendars?$top=100`
    );

  while (nextUrl) {
    const response =
      await fetchImpl(
        nextUrl,
        {
          method: "GET",
          headers: {
            authorization:
              `Bearer ${input.accessToken}`,
            accept:
              "application/json"
          }
        }
      );

    if (!response.ok) {
      throw providerError(
        response,
        "calendar.list"
      );
    }

    const page =
      (await response.json()) as
        CalendarListPage;

    for (
      const calendar of
      page.value ?? []
    ) {
      if (!calendar.id) {
        continue;
      }

      entries.push({
        id:
          calendar.id,
        name:
          calendar.name?.trim() ||
          "Microsoft Calendar",
        primary:
          Boolean(
            calendar
              .isDefaultCalendar
          ),
        writable:
          Boolean(
            calendar.canEdit
          ),
        ownerAddress:
          calendar.owner
            ?.address
      });
    }

    nextUrl =
      page["@odata.nextLink"]
        ? assertGraphNextLink(
            page[
              "@odata.nextLink"
            ]!
          )
        : undefined;
  }

  return entries;
}
