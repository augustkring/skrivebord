import { resolveSystemPrincipal } from "@skrivebord/auth";
import {
  ConnectorError,
  GoogleCalendarConnector,
  refreshGoogleAccessToken,
  type GoogleOAuthTokens
} from "@skrivebord/connectors";
import {
  clearCalendarSourceForFullResync,
  getGoogleSyncContext,
  persistCalendarSync,
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

function initialWindow(now: Date): {
  timeMin: string;
  timeMax: string;
} {
  return {
    timeMin: new Date(
      now.getTime() - 183 * 24 * 60 * 60 * 1000
    ).toISOString(),
    timeMax: new Date(
      now.getTime() + 548 * 24 * 60 * 60 * 1000
    ).toISOString()
  };
}

export type GoogleCalendarSyncSummary = {
  connectorAccountId: string;
  calendarsAttempted: number;
  calendarsSucceeded: number;
  calendarsFailed: number;
  fullResyncs: number;
  eventsSeen: number;
  eventsCreated: number;
  eventsUpdated: number;
  eventsDeleted: number;
};

export async function runGoogleCalendarSync(input: {
  workspaceId: string;
  sourceIds?: string[];
  now?: Date;
}): Promise<GoogleCalendarSyncSummary> {
  const now = input.now ?? new Date();
  const systemPrincipal = resolveSystemPrincipal(
    {
      jobId: "system:google-calendar-sync",
      workspaceId: input.workspaceId,
      capabilities: []
    },
    crypto.randomUUID()
  );

  const context = await withPrincipalTransaction(
    databasePool,
    systemPrincipal,
    ({ db }) =>
      getGoogleSyncContext(db, input.workspaceId)
  );

  if (!context) {
    throw new Error("GOOGLE_CONNECTION_NOT_FOUND");
  }

  if (!context.credential) {
    throw new Error("GOOGLE_CREDENTIAL_NOT_FOUND");
  }

  const protector = getConnectorProtector();
  let tokens = StoredGoogleTokensSchema.parse(
    JSON.parse(
      protector.unprotect(
        context.credential.encryptedPayload
      )
    )
  ) as GoogleOAuthTokens;

  const oauthConfig = getGoogleOAuthRuntimeConfig();

  if (needsRefresh(tokens, now)) {
    try {
      const refreshed = await refreshGoogleAccessToken({
        clientId: oauthConfig.clientId,
        clientSecret: oauthConfig.clientSecret,
        refreshToken: tokens.refreshToken!,
        now
      });

      tokens = {
        ...refreshed,
        refreshToken: tokens.refreshToken,
        scope:
          refreshed.scope.length > 0
            ? refreshed.scope
            : tokens.scope
      };

      const encrypted = protector.protect(
        JSON.stringify(tokens)
      );

      await withPrincipalTransaction(
        databasePool,
        systemPrincipal,
        ({ db }) =>
          storeConnectorCredential(db, {
            workspaceId: input.workspaceId,
            connectorAccountId: context.account.id,
            encryptedPayload: encrypted,
            keyId: protector.activeKeyId,
            expiresAt: tokens.expiresAt
              ? new Date(tokens.expiresAt)
              : undefined,
            rotatedAt: now,
            now
          })
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
          recordCalendarSyncFailure(db, {
            workspaceId: input.workspaceId,
            connectorAccountId: context.account.id,
            mode: "INCREMENTAL",
            failureCode:
              connectorError?.code ??
              "TOKEN_REFRESH_FAILED",
            authExpired:
              connectorError?.code === "AUTH_EXPIRED",
            now
          })
      );

      throw error;
    }
  }

  const connector = new GoogleCalendarConnector();

  const selectedSources =
    input.sourceIds && input.sourceIds.length > 0
      ? context.sources.filter((source) =>
          input.sourceIds?.includes(source.id)
        )
      : context.sources;

  const summary: GoogleCalendarSyncSummary = {
    connectorAccountId: context.account.id,
    calendarsAttempted: selectedSources.length,
    calendarsSucceeded: 0,
    calendarsFailed: 0,
    fullResyncs: 0,
    eventsSeen: 0,
    eventsCreated: 0,
    eventsUpdated: 0,
    eventsDeleted: 0
  };

  const cursorByScope = new Map(
    context.cursors.map((cursor) => [
      cursor.resourceScope,
      cursor
    ])
  );

  for (const source of selectedSources) {
    const cursorRow = cursorByScope.get(
      source.providerCalendarId
    );
    let mode: "INITIAL" | "INCREMENTAL" =
      cursorRow ? "INCREMENTAL" : "INITIAL";

    try {
      let syncResult;

      if (cursorRow) {
        const rawCursor = protector.unprotect(
          cursorRow.cursorValueProtected
        );

        syncResult = await connector.incrementalSync({
          accessToken: tokens.accessToken,
          calendarId: source.providerCalendarId,
          cursor: {
            type: "GOOGLE_SYNC_TOKEN",
            value: rawCursor
          }
        });
      } else {
        const window = initialWindow(now);
        syncResult = await connector.initialSync({
          accessToken: tokens.accessToken,
          calendarId: source.providerCalendarId,
          ...window
        });
      }

      if (syncResult.fullResyncRequired) {
        summary.fullResyncs += 1;
        mode = "INITIAL";

        await withPrincipalTransaction(
          databasePool,
          systemPrincipal,
          ({ db }) =>
            clearCalendarSourceForFullResync(db, {
              workspaceId: input.workspaceId,
              connectorAccountId:
                context.account.id,
              calendarSourceId: source.id,
              resourceScope:
                source.providerCalendarId,
              now
            })
        );

        const window = initialWindow(now);
        syncResult = await connector.initialSync({
          accessToken: tokens.accessToken,
          calendarId: source.providerCalendarId,
          ...window
        });
      }

      const persisted =
        await withPrincipalTransaction(
          databasePool,
          systemPrincipal,
          ({ db }) =>
            persistCalendarSync(db, {
              workspaceId: input.workspaceId,
              connectorAccountId:
                context.account.id,
              calendarSourceId: source.id,
              resourceScope:
                source.providerCalendarId,
              provider: "GOOGLE",
              mode,
              result: syncResult,
              protectCursor: (raw) =>
                protector.protect(raw),
              now
            })
        );

      summary.calendarsSucceeded += 1;
      summary.eventsSeen += persisted.itemsSeen;
      summary.eventsCreated +=
        persisted.itemsCreated;
      summary.eventsUpdated +=
        persisted.itemsUpdated;
      summary.eventsDeleted +=
        persisted.itemsDeleted;
    } catch (error) {
      summary.calendarsFailed += 1;

      const connectorError =
        error instanceof ConnectorError
          ? error
          : undefined;

      await withPrincipalTransaction(
        databasePool,
        systemPrincipal,
        ({ db }) =>
          recordCalendarSyncFailure(db, {
            workspaceId: input.workspaceId,
            connectorAccountId:
              context.account.id,
            calendarSourceId: source.id,
            mode,
            failureCode:
              connectorError?.code ??
              "SYNC_FAILED",
            authExpired:
              connectorError?.code === "AUTH_EXPIRED",
            now
          })
      );

      if (connectorError?.code === "AUTH_EXPIRED") {
        break;
      }
    }
  }

  return summary;
}
