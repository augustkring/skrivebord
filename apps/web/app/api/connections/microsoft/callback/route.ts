import {
  executeAction
} from "@skrivebord/actions";
import {
  resolveSystemPrincipal
} from "@skrivebord/auth";
import {
  exchangeMicrosoftAuthorizationCode,
  fetchMicrosoftAccountIdentity,
  listMicrosoftCalendars
} from "@skrivebord/connectors";
import {
  TransactionalPostgresActionStore,
  upsertMicrosoftConnection,
  withPrincipalTransaction
} from "@skrivebord/database";
import { cookies } from "next/headers";
import { z } from "zod";
import {
  getConnectorProtector,
  getMicrosoftOAuthRuntimeConfig
} from "@/lib/connector-security";
import {
  databasePool
} from "@/lib/database";
import {
  runMicrosoftCalendarSync
} from "@/lib/microsoft-sync";
import {
  MICROSOFT_PKCE_COOKIE,
  verifyMicrosoftPkceCookie
} from "@/lib/microsoft-pkce";
import {
  verifyConnectorOAuthState
} from "@/lib/oauth-state";
import {
  resolveWorkspaceHumanPrincipal
} from "@/lib/principal";

function redirectWithStatus(
  returnPath: string,
  status: string
): Response {
  const baseUrl =
    process.env.BETTER_AUTH_URL;

  if (!baseUrl) {
    return Response.json(
      { error: status },
      { status: 500 }
    );
  }

  const target =
    new URL(
      returnPath,
      baseUrl
    );

  target.searchParams.set(
    "microsoft",
    status
  );

  return Response.redirect(
    target,
    302
  );
}

async function clearPkceCookie() {
  const cookieStore =
    await cookies();

  cookieStore.set(
    MICROSOFT_PKCE_COOKIE,
    "",
    {
      httpOnly: true,
      sameSite: "lax",
      secure:
        process.env
          .BETTER_AUTH_URL
          ?.startsWith(
            "https://"
          ) ?? false,
      path:
        "/api/connections/microsoft/callback",
      maxAge: 0
    }
  );
}

export async function GET(
  request: Request
) {
  const requestUrl =
    new URL(request.url);

  const rawState =
    requestUrl.searchParams.get(
      "state"
    );
  const code =
    requestUrl.searchParams.get(
      "code"
    );
  const providerError =
    requestUrl.searchParams.get(
      "error"
    );

  if (!rawState) {
    return Response.json(
      {
        error:
          "MISSING_OAUTH_STATE"
      },
      { status: 400 }
    );
  }

  const config =
    getMicrosoftOAuthRuntimeConfig();

  let state;
  try {
    state =
      verifyConnectorOAuthState({
        token: rawState,
        secret:
          config.stateSecret
      });
  } catch {
    return Response.json(
      {
        error:
          "INVALID_OAUTH_STATE"
      },
      { status: 400 }
    );
  }

  if (
    state.provider !==
    "MICROSOFT"
  ) {
    return Response.json(
      {
        error:
          "OAUTH_PROVIDER_MISMATCH"
      },
      { status: 400 }
    );
  }

  const cookieStore =
    await cookies();
  const pkceToken =
    cookieStore.get(
      MICROSOFT_PKCE_COOKIE
    )?.value;

  if (!pkceToken) {
    return Response.json(
      {
        error:
          "MICROSOFT_PKCE_COOKIE_MISSING"
      },
      { status: 400 }
    );
  }

  let codeVerifier:
    | string;

  try {
    codeVerifier =
      verifyMicrosoftPkceCookie({
        token:
          pkceToken,
        expectedStateNonce:
          state.nonce,
        secret:
          config.stateSecret
      });
  } catch {
    await clearPkceCookie();

    return Response.json(
      {
        error:
          "INVALID_MICROSOFT_PKCE"
      },
      { status: 400 }
    );
  }

  if (providerError) {
    await clearPkceCookie();

    return redirectWithStatus(
      state.returnPath,
      "denied"
    );
  }

  if (!code) {
    await clearPkceCookie();

    return redirectWithStatus(
      state.returnPath,
      "missing-code"
    );
  }

  const principal =
    await resolveWorkspaceHumanPrincipal({
      workspaceSlug:
        state.workspaceSlug,
      requestId:
        crypto.randomUUID()
    });

  if (
    !principal ||
    principal.workspaceId !==
      state.workspaceId ||
    principal.principalId !==
      state.principalId ||
    !principal.capabilities.includes(
      "connection.manage"
    )
  ) {
    await clearPkceCookie();

    return Response.json(
      {
        error:
          "OAUTH_PRINCIPAL_MISMATCH"
      },
      { status: 403 }
    );
  }

  const store =
    new TransactionalPostgresActionStore(
      databasePool,
      principal
    );

  const InputSchema =
    z.object({
      workspaceId:
        z.string().min(1),
      stateNonce:
        z.string().min(16)
    }).strict();

  const result =
    await executeAction({
      definition: {
        id:
          "connection.microsoft.complete",
        input:
          InputSchema,
        requiredCapabilities: [
          "connection.manage"
        ],
        risk: () =>
          "MEDIUM",
        reversible: true,
        preview: async () =>
          "Forbind Microsoft Calendar",
        execute: async () => {
          const tokens =
            await exchangeMicrosoftAuthorizationCode({
              tenant:
                config.tenant,
              clientId:
                config.clientId,
              clientSecret:
                config.clientSecret,
              redirectUri:
                config.redirectUri,
              code,
              codeVerifier
            });

          if (
            !tokens
              .refreshToken
          ) {
            throw new Error(
              "MICROSOFT_REFRESH_TOKEN_REQUIRED"
            );
          }

          const [
            identity,
            calendars
          ] =
            await Promise.all([
              fetchMicrosoftAccountIdentity({
                accessToken:
                  tokens.accessToken
              }),
              listMicrosoftCalendars({
                accessToken:
                  tokens.accessToken
              })
            ]);

          const protector =
            getConnectorProtector();

          const encryptedCredential =
            protector.protect(
              JSON.stringify(
                tokens
              )
            );

          const systemPrincipal =
            resolveSystemPrincipal(
              {
                jobId:
                  "system:microsoft-connection",
                workspaceId:
                  principal
                    .workspaceId,
                capabilities: []
              },
              crypto.randomUUID()
            );

          const persisted =
            await withPrincipalTransaction(
              databasePool,
              systemPrincipal,
              ({ db }) =>
                upsertMicrosoftConnection(
                  db,
                  {
                    workspaceId:
                      principal
                        .workspaceId,
                    connectedBy:
                      principal
                        .principalId,
                    identity,
                    tokens,
                    encryptedCredential,
                    keyId:
                      protector
                        .activeKeyId,
                    calendars
                  }
                )
            );

          const initialSync =
            persisted
              .primaryCalendarSourceId
              ? await runMicrosoftCalendarSync({
                  workspaceId:
                    principal
                      .workspaceId,
                  sourceIds: [
                    persisted
                      .primaryCalendarSourceId
                  ]
                })
              : undefined;

          return {
            provider:
              "MICROSOFT" as const,
            accountEmail:
              identity.email,
            connectorAccountId:
              persisted
                .connectorAccountId,
            calendarsDiscovered:
              persisted
                .calendarsDiscovered,
            writableCalendars:
              persisted
                .writableCalendars,
            primaryCalendarSynced:
              initialSync
                ?.calendarsSucceeded ===
              1,
            primaryEventsSeen:
              initialSync
                ?.eventsSeen ??
              0
          };
        }
      },
      principal,
      rawInput: {
        workspaceId:
          principal.workspaceId,
        stateNonce:
          state.nonce
      },
      store
    });

  await clearPkceCookie();

  if (
    result.status !==
    "SUCCEEDED"
  ) {
    return redirectWithStatus(
      state.returnPath,
      "error"
    );
  }

  return redirectWithStatus(
    state.returnPath,
    "connected"
  );
}
