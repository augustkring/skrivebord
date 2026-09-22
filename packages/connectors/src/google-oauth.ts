import { ConnectorError } from "./calendar";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
] as const;

export type GoogleOAuthTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  tokenType?: string;
  scope: string[];
  idToken?: string;
};

export type GoogleAccountIdentity = {
  subject: string;
  email: string;
  emailVerified?: boolean;
};

export type GoogleCalendarListEntry = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole:
    | "freeBusyReader"
    | "reader"
    | "writer"
    | "writerWithoutPrivateAccess"
    | "owner"
    | string;
  timeZone?: string;
  deleted: boolean;
  hidden: boolean;
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleUserInfoResponse = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
};

type GoogleCalendarListPage = {
  items?: Array<{
    id?: string;
    summary?: string;
    primary?: boolean;
    accessRole?: string;
    timeZone?: string;
    deleted?: boolean;
    hidden?: boolean;
  }>;
  nextPageToken?: string;
};

export function buildGoogleAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", input.state);
  return url.toString();
}

function providerError(
  response: Response,
  operation: string
): ConnectorError {
  if (response.status === 400 || response.status === 401) {
    return new ConnectorError(
      `${operation}: Google authorization blev afvist.`,
      "AUTH_EXPIRED",
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

export async function exchangeGoogleAuthorizationCode(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<GoogleOAuthTokens> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json"
    },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri
    })
  });

  if (!response.ok) {
    throw providerError(response, "oauth.code_exchange");
  }

  const body = (await response.json()) as GoogleTokenResponse;
  if (!body.access_token) {
    throw new ConnectorError(
      body.error_description ?? "Google returnerede intet access token.",
      "INVALID_RESPONSE",
      false
    );
  }

  const now = input.now ?? new Date();
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: body.expires_in
      ? new Date(now.getTime() + body.expires_in * 1000).toISOString()
      : undefined,
    tokenType: body.token_type,
    scope: body.scope?.split(" ").filter(Boolean) ?? [],
    idToken: body.id_token
  };
}

export async function refreshGoogleAccessToken(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<GoogleOAuthTokens> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json"
    },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token"
    })
  });

  if (!response.ok) {
    throw providerError(response, "oauth.refresh");
  }

  const body = (await response.json()) as GoogleTokenResponse;
  if (!body.access_token) {
    throw new ConnectorError(
      "Google returnerede intet refreshed access token.",
      "INVALID_RESPONSE",
      false
    );
  }

  const now = input.now ?? new Date();
  return {
    accessToken: body.access_token,
    refreshToken: input.refreshToken,
    expiresAt: body.expires_in
      ? new Date(now.getTime() + body.expires_in * 1000).toISOString()
      : undefined,
    tokenType: body.token_type,
    scope: body.scope?.split(" ").filter(Boolean) ?? [],
    idToken: body.id_token
  };
}

export async function fetchGoogleAccountIdentity(input: {
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<GoogleAccountIdentity> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(GOOGLE_USERINFO_URL, {
    method: "GET",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw providerError(response, "oauth.userinfo");
  }

  const body = (await response.json()) as GoogleUserInfoResponse;
  if (!body.sub || !body.email) {
    throw new ConnectorError(
      "Google userinfo manglede subject eller email.",
      "INVALID_RESPONSE",
      false
    );
  }

  return {
    subject: body.sub,
    email: body.email,
    emailVerified: body.email_verified
  };
}

export async function listGoogleCalendars(input: {
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<GoogleCalendarListEntry[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const entries: GoogleCalendarListEntry[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(
      `${GOOGLE_CALENDAR_BASE}/users/me/calendarList`
    );
    url.searchParams.set("maxResults", "250");
    url.searchParams.set("minAccessRole", "reader");
    url.searchParams.set("showDeleted", "false");
    url.searchParams.set("showHidden", "false");

    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        accept: "application/json"
      }
    });

    if (!response.ok) {
      throw providerError(response, "calendarList.list");
    }

    const body = (await response.json()) as GoogleCalendarListPage;

    for (const entry of body.items ?? []) {
      if (!entry.id) continue;

      entries.push({
        id: entry.id,
        summary: entry.summary?.trim() || entry.id,
        primary: Boolean(entry.primary),
        accessRole: entry.accessRole ?? "reader",
        timeZone: entry.timeZone,
        deleted: Boolean(entry.deleted),
        hidden: Boolean(entry.hidden)
      });
    }

    pageToken = body.nextPageToken;
  } while (pageToken);

  return entries;
}

export function googleCalendarAccessRoleWritable(
  accessRole: string
): boolean {
  return [
    "writer",
    "writerWithoutPrivateAccess",
    "owner"
  ].includes(accessRole);
}
