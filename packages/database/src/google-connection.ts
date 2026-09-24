import type {
  GoogleAccountIdentity,
  GoogleCalendarListEntry,
  GoogleOAuthTokens
} from "@skrivebord/connectors";
import { and, eq } from "drizzle-orm";
import type { SkrivebordDatabase } from "./client";
import {
  calendarSource,
  connectorAccount
} from "./schema";
import { storeConnectorCredential } from "./connector-credentials";

export type UpsertGoogleConnectionInput = {
  workspaceId: string;
  connectedBy: string;
  identity: GoogleAccountIdentity;
  tokens: GoogleOAuthTokens;
  encryptedCredential: string;
  keyId: string;
  calendars: GoogleCalendarListEntry[];
  now?: Date;
};

export type UpsertGoogleConnectionResult = {
  connectorAccountId: string;
  calendarsDiscovered: number;
  writableCalendars: number;
  primaryCalendarSourceId?: string;
};

function calendarWritable(accessRole: string): boolean {
  return [
    "writer",
    "writerWithoutPrivateAccess",
    "owner"
  ].includes(accessRole);
}

export async function upsertGoogleConnection(
  db: SkrivebordDatabase,
  input: UpsertGoogleConnectionInput
): Promise<UpsertGoogleConnectionResult> {
  const now = input.now ?? new Date();

  const [account] = await db
    .insert(connectorAccount)
    .values({
      workspaceId: input.workspaceId,
      provider: "GOOGLE",
      displayName: input.identity.email,
      providerAccountId: input.identity.subject,
      status: "CONNECTED",
      scopes: input.tokens.scope,
      connectedBy: input.connectedBy,
      connectedAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: [
        connectorAccount.workspaceId,
        connectorAccount.provider,
        connectorAccount.providerAccountId
      ],
      set: {
        displayName: input.identity.email,
        status: "CONNECTED",
        scopes: input.tokens.scope,
        connectedBy: input.connectedBy,
        lastErrorCode: null,
        updatedAt: now
      }
    })
    .returning({ id: connectorAccount.id });

  if (!account) {
    throw new Error("GOOGLE_CONNECTOR_ACCOUNT_UPSERT_FAILED");
  }

  await storeConnectorCredential(db, {
    workspaceId: input.workspaceId,
    connectorAccountId: account.id,
    encryptedPayload: input.encryptedCredential,
    keyId: input.keyId,
    expiresAt: input.tokens.expiresAt
      ? new Date(input.tokens.expiresAt)
      : undefined,
    now
  });

  let writableCalendars = 0;
  let primaryCalendarSourceId: string | undefined;

  for (const calendar of input.calendars) {
    if (calendar.deleted || calendar.hidden) continue;

    const writable = calendarWritable(calendar.accessRole);
    if (writable) writableCalendars += 1;

    const [source] = await db
      .insert(calendarSource)
      .values({
        workspaceId: input.workspaceId,
        provider: "GOOGLE",
        connectorAccountId: account.id,
        providerCalendarId: calendar.id,
        displayName: calendar.summary,
        writable,
        isPrimary: calendar.primary,
        accessRole: calendar.accessRole,
        syncState: "CONNECTED",
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: [
          calendarSource.workspaceId,
          calendarSource.provider,
          calendarSource.providerCalendarId
        ],
        set: {
          connectorAccountId: account.id,
          displayName: calendar.summary,
          writable,
          isPrimary: calendar.primary,
          accessRole: calendar.accessRole,
          syncState: "CONNECTED",
          updatedAt: now
        }
      })
      .returning({
        id: calendarSource.id
      });

    if (calendar.primary && source) {
      primaryCalendarSourceId = source.id;
    }
  }

  return {
    connectorAccountId: account.id,
    calendarsDiscovered: input.calendars.filter(
      (calendar) => !calendar.deleted && !calendar.hidden
    ).length,
    writableCalendars,
    primaryCalendarSourceId
  };
}

export async function getGoogleConnection(
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

  const sources = await db
    .select()
    .from(calendarSource)
    .where(
      and(
        eq(calendarSource.workspaceId, workspaceId),
        eq(calendarSource.connectorAccountId, account.id)
      )
    );

  return {
    account,
    sources
  };
}
