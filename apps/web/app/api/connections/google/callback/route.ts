import { executeAction } from "@skrivebord/actions";
import { resolveSystemPrincipal } from "@skrivebord/auth";
import {
  exchangeGoogleAuthorizationCode,
  fetchGoogleAccountIdentity,
  listGoogleCalendars
} from "@skrivebord/connectors";
import {
  TransactionalPostgresActionStore,
  upsertGoogleConnection,
  withPrincipalTransaction
} from "@skrivebord/database";
import { z } from "zod";
import {
  getConnectorProtector,
  getGoogleOAuthRuntimeConfig
} from "@/lib/connector-security";
import { databasePool } from "@/lib/database";
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
  const baseUrl = process.env.BETTER_AUTH_URL;
  if (!baseUrl) {
    return Response.json(
      { error: status },
      { status: 500 }
    );
  }

  const target = new URL(returnPath, baseUrl);
  target.searchParams.set("google", status);
  return Response.redirect(target, 302);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const rawState = requestUrl.searchParams.get("state");
  const code = requestUrl.searchParams.get("code");
  const providerError = requestUrl.searchParams.get("error");

  if (!rawState) {
    return Response.json(
      { error: "MISSING_OAUTH_STATE" },
      { status: 400 }
    );
  }

  const config = getGoogleOAuthRuntimeConfig();

  let state;
  try {
    state = verifyConnectorOAuthState({
      token: rawState,
      secret: config.stateSecret
    });
  } catch {
    return Response.json(
      { error: "INVALID_OAUTH_STATE" },
      { status: 400 }
    );
  }

  if (providerError) {
    return redirectWithStatus(
      state.returnPath,
      "denied"
    );
  }

  if (!code) {
    return redirectWithStatus(
      state.returnPath,
      "missing-code"
    );
  }

  const principal = await resolveWorkspaceHumanPrincipal({
    workspaceSlug: state.workspaceSlug,
    requestId: crypto.randomUUID()
  });

  if (
    !principal ||
    principal.workspaceId !== state.workspaceId ||
    principal.principalId !== state.principalId ||
    !principal.capabilities.includes("connection.manage")
  ) {
    return Response.json(
      { error: "OAUTH_PRINCIPAL_MISMATCH" },
      { status: 403 }
    );
  }

  const store = new TransactionalPostgresActionStore(
    databasePool,
    principal
  );

  const InputSchema = z.object({
    workspaceId: z.string().min(1),
    stateNonce: z.string().min(16)
  }).strict();

  const result = await executeAction({
    definition: {
      id: "connection.google.complete",
      input: InputSchema,
      requiredCapabilities: ["connection.manage"],
      risk: () => "MEDIUM",
      reversible: true,
      preview: async () => "Forbind Google Calendar",
      execute: async () => {
        const tokens = await exchangeGoogleAuthorizationCode({
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          redirectUri: config.redirectUri,
          code
        });

        if (!tokens.refreshToken) {
          throw new Error(
            "GOOGLE_REFRESH_TOKEN_REQUIRED"
          );
        }

        const [
          identity,
          calendars
        ] = await Promise.all([
          fetchGoogleAccountIdentity({
            accessToken: tokens.accessToken
          }),
          listGoogleCalendars({
            accessToken: tokens.accessToken
          })
        ]);

        const protector = getConnectorProtector();
        const encryptedCredential = protector.protect(
          JSON.stringify(tokens)
        );

        const systemPrincipal =
          resolveSystemPrincipal(
            {
              jobId: "system:google-connection",
              workspaceId: principal.workspaceId,
              capabilities: []
            },
            crypto.randomUUID()
          );

        const persisted =
          await withPrincipalTransaction(
            databasePool,
            systemPrincipal,
            ({ db }) =>
              upsertGoogleConnection(db, {
                workspaceId: principal.workspaceId,
                connectedBy: principal.principalId,
                identity,
                tokens,
                encryptedCredential,
                keyId: protector.activeKeyId,
                calendars
              })
          );

        return {
          provider: "GOOGLE" as const,
          accountEmail: identity.email,
          connectorAccountId:
            persisted.connectorAccountId,
          calendarsDiscovered:
            persisted.calendarsDiscovered,
          writableCalendars:
            persisted.writableCalendars
        };
      }
    },
    principal,
    rawInput: {
      workspaceId: principal.workspaceId,
      stateNonce: state.nonce
    },
    store
  });

  if (result.status !== "SUCCEEDED") {
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
