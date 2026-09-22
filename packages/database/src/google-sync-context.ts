import { and, eq } from "drizzle-orm";
import type { SkrivebordDatabase } from "./client";
import { readConnectorCredential } from "./connector-credentials";
import {
  calendarSource,
  connectorAccount,
  syncCursor,
  syncRun
} from "./schema";

export async function getGoogleSyncContext(
  db: SkrivebordDatabase,
  workspaceId: string
) {
  const [account] = await db
    .select()
    .from(connectorAccount)
    .where(
      and(
        eq(connectorAccount.workspaceId, workspaceId),
        eq(connectorAccount.provider, "GOOGLE")
      )
    )
    .limit(1);

  if (!account) return undefined;

  const [credential, sources, cursors] = await Promise.all([
    readConnectorCredential(db, {
      workspaceId,
      connectorAccountId: account.id
    }),
    db
      .select()
      .from(calendarSource)
      .where(
        and(
          eq(calendarSource.workspaceId, workspaceId),
          eq(calendarSource.connectorAccountId, account.id),
          eq(calendarSource.provider, "GOOGLE")
        )
      ),
    db
      .select()
      .from(syncCursor)
      .where(
        and(
          eq(syncCursor.workspaceId, workspaceId),
          eq(syncCursor.connectorAccountId, account.id),
          eq(syncCursor.resourceType, "CALENDAR_EVENTS")
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

export async function recordCalendarSyncFailure(
  db: SkrivebordDatabase,
  input: {
    workspaceId: string;
    connectorAccountId: string;
    calendarSourceId?: string;
    mode: "INITIAL" | "INCREMENTAL";
    failureCode: string;
    authExpired: boolean;
    now?: Date;
  }
): Promise<void> {
  const now = input.now ?? new Date();

  await db.insert(syncRun).values({
    workspaceId: input.workspaceId,
    connectorAccountId: input.connectorAccountId,
    mode: input.mode,
    status: "FAILED",
    startedAt: now,
    completedAt: now,
    failureCode: input.failureCode
  });

  await db
    .update(connectorAccount)
    .set({
      status: input.authExpired
        ? "AUTH_EXPIRED"
        : "DEGRADED",
      lastErrorCode: input.failureCode,
      updatedAt: now
    })
    .where(
      and(
        eq(connectorAccount.id, input.connectorAccountId),
        eq(connectorAccount.workspaceId, input.workspaceId)
      )
    );

  if (input.calendarSourceId) {
    await db
      .update(calendarSource)
      .set({
        syncState: input.authExpired
          ? "AUTH_EXPIRED"
          : "DEGRADED",
        updatedAt: now
      })
      .where(
        and(
          eq(calendarSource.id, input.calendarSourceId),
          eq(calendarSource.workspaceId, input.workspaceId)
        )
      );
  }
}
