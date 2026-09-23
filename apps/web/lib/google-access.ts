import { resolveSystemPrincipal } from "@skrivebord/auth";
import {
  ConnectorError,
  refreshGoogleAccessToken,
  type GoogleOAuthTokens
} from "@skrivebord/connectors";
import {
  getGoogleSyncContext,
  recordCalendarSyncFailure,
  storeConnectorCredential,
  withPrincipalTransaction
} from "@skrivebord/database";
import { z } from "zod";
import {
  getConnectorProtector,
  getGoogleOAuthRuntimeConfig
} from "./connector-security";
import { databasePool } from "./database";

const StoredGoogleTokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.string().datetime().optional(),
  tokenType: z.string().optional(),
  scope: z.array(z.string()),
  idToken: z.string().optional()
}).strict();

function needsRefresh(
  tokens: GoogleOAuthTokens,
  now: Date
): boolean {
  if (!tokens.expiresAt) return true;

  return (
    new Date(tokens.expiresAt).getTime() -
      now.getTime() <
    5 * 60 * 1000
  );
}

export async function getGoogleAccessContext(input: {
  workspaceId: string;
  jobId: string;
  connectorAccountId?: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const systemPrincipal =
    resolveSystemPrincipal(
      {
        jobId: input.jobId,
        workspaceId: input.workspaceId,
        capabilities: []
      },
      crypto.randomUUID()
    );

  const context =
    await withPrincipalTransaction(
      databasePool,
      systemPrincipal,
      ({ db }) =>
        getGoogleSyncContext(
          db,
          input.workspaceId,
          input.connectorAccountId
        )
    );

  if (!context) {
    throw new Error(
      "GOOGLE_CONNECTION_NOT_FOUND"
    );
  }

  if (!context.credential) {
    throw new Error(
      "GOOGLE_CREDENTIAL_NOT_FOUND"
    );
  }

  const protector =
    getConnectorProtector();

  let tokens =
    StoredGoogleTokensSchema.parse(
      JSON.parse(
        protector.unprotect(
          context.credential
            .encryptedPayload
        )
      )
    ) as GoogleOAuthTokens;

  if (needsRefresh(tokens, now)) {
    const oauthConfig =
      getGoogleOAuthRuntimeConfig();

    try {
      const refreshed =
        await refreshGoogleAccessToken({
          clientId:
            oauthConfig.clientId,
          clientSecret:
            oauthConfig.clientSecret,
          refreshToken:
            tokens.refreshToken!,
          now
        });

      tokens = {
        ...refreshed,
        refreshToken:
          tokens.refreshToken,
        scope:
          refreshed.scope.length > 0
            ? refreshed.scope
            : tokens.scope
      };

      const encrypted =
        protector.protect(
          JSON.stringify(tokens)
        );

      await withPrincipalTransaction(
        databasePool,
        systemPrincipal,
        ({ db }) =>
          storeConnectorCredential(
            db,
            {
              workspaceId:
                input.workspaceId,
              connectorAccountId:
                context.account.id,
              encryptedPayload:
                encrypted,
              keyId:
                protector.activeKeyId,
              expiresAt:
                tokens.expiresAt
                  ? new Date(
                      tokens.expiresAt
                    )
                  : undefined,
              rotatedAt: now,
              now
            }
          )
      );
    } catch (error) {
      const connectorError =
        error instanceof ConnectorError
          ? error
          : undefined;

      await withPrincipalTransaction(
        databasePool,
        systemPrincipal,
        ({ db }) =>
          recordCalendarSyncFailure(
            db,
            {
              workspaceId:
                input.workspaceId,
              connectorAccountId:
                context.account.id,
              mode: "INCREMENTAL",
              failureCode:
                connectorError?.code ??
                "TOKEN_REFRESH_FAILED",
              authExpired:
                connectorError?.code ===
                "AUTH_EXPIRED",
              now
            }
          )
      );

      throw error;
    }
  }

  return {
    now,
    systemPrincipal,
    context,
    tokens,
    protector
  };
}
