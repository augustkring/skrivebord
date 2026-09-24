import {
  and,
  eq
} from "drizzle-orm";
import type {
  SkrivebordDatabase
} from "./client";
import {
  readConnectorCredential
} from "./connector-credentials";
import {
  calendarSource,
  connectorAccount,
  syncCursor
} from "./schema";

export async function getMicrosoftSyncContext(
  db: SkrivebordDatabase,
  workspaceId: string,
  connectorAccountId?: string
) {
  const [account] =
    await db
      .select()
      .from(
        connectorAccount
      )
      .where(
        and(
          eq(
            connectorAccount
              .workspaceId,
            workspaceId
          ),
          eq(
            connectorAccount
              .provider,
            "MICROSOFT"
          ),
          ...(connectorAccountId
            ? [
                eq(
                  connectorAccount
                    .id,
                  connectorAccountId
                )
              ]
            : [])
        )
      )
      .limit(1);

  if (!account) {
    return undefined;
  }

  const [
    credential,
    sources,
    cursors
  ] = await Promise.all([
    readConnectorCredential(
      db,
      {
        workspaceId,
        connectorAccountId:
          account.id
      }
    ),
    db
      .select()
      .from(
        calendarSource
      )
      .where(
        and(
          eq(
            calendarSource
              .workspaceId,
            workspaceId
          ),
          eq(
            calendarSource
              .connectorAccountId,
            account.id
          ),
          eq(
            calendarSource
              .provider,
            "MICROSOFT"
          )
        )
      ),
    db
      .select()
      .from(syncCursor)
      .where(
        and(
          eq(
            syncCursor
              .workspaceId,
            workspaceId
          ),
          eq(
            syncCursor
              .connectorAccountId,
            account.id
          ),
          eq(
            syncCursor
              .resourceType,
            "CALENDAR_EVENTS"
          )
        )
      )
  ]);

  return {
    account,
    credential,
    sources,
    cursors
  };
}
