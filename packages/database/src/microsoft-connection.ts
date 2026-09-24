import type {
  MicrosoftAccountIdentity,
  MicrosoftCalendarListEntry,
  MicrosoftOAuthTokens
} from "@skrivebord/connectors";
import { and, eq } from "drizzle-orm";
import type {
  SkrivebordDatabase
} from "./client";
import {
  calendarSource,
  connectorAccount
} from "./schema";
import {
  storeConnectorCredential
} from "./connector-credentials";

export type UpsertMicrosoftConnectionInput = {
  workspaceId: string;
  connectedBy: string;
  identity:
    MicrosoftAccountIdentity;
  tokens:
    MicrosoftOAuthTokens;
  encryptedCredential: string;
  keyId: string;
  calendars:
    MicrosoftCalendarListEntry[];
  now?: Date;
};

export type UpsertMicrosoftConnectionResult = {
  connectorAccountId: string;
  calendarsDiscovered: number;
  writableCalendars: number;
  primaryCalendarSourceId?: string;
};

export async function upsertMicrosoftConnection(
  db: SkrivebordDatabase,
  input: UpsertMicrosoftConnectionInput
): Promise<UpsertMicrosoftConnectionResult> {
  const now =
    input.now ?? new Date();

  const [account] =
    await db
      .insert(
        connectorAccount
      )
      .values({
        workspaceId:
          input.workspaceId,
        provider:
          "MICROSOFT",
        displayName:
          input.identity.email,
        providerAccountId:
          input.identity.id,
        status:
          "CONNECTED",
        scopes:
          input.tokens.scope,
        connectedBy:
          input.connectedBy,
        connectedAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: [
          connectorAccount
            .workspaceId,
          connectorAccount
            .provider,
          connectorAccount
            .providerAccountId
        ],
        set: {
          displayName:
            input.identity.email,
          status:
            "CONNECTED",
          scopes:
            input.tokens.scope,
          connectedBy:
            input.connectedBy,
          lastErrorCode:
            null,
          updatedAt: now
        }
      })
      .returning({
        id:
          connectorAccount.id
      });

  if (!account) {
    throw new Error(
      "MICROSOFT_CONNECTOR_ACCOUNT_UPSERT_FAILED"
    );
  }

  await storeConnectorCredential(
    db,
    {
      workspaceId:
        input.workspaceId,
      connectorAccountId:
        account.id,
      encryptedPayload:
        input.encryptedCredential,
      keyId:
        input.keyId,
      expiresAt:
        input.tokens.expiresAt
          ? new Date(
              input.tokens
                .expiresAt
            )
          : undefined,
      now
    }
  );

  let writableCalendars = 0;
  let primaryCalendarSourceId:
    | string
    | undefined;

  for (
    const calendar of
    input.calendars
  ) {
    if (calendar.writable) {
      writableCalendars += 1;
    }

    const [source] =
      await db
        .insert(
          calendarSource
        )
        .values({
          workspaceId:
            input.workspaceId,
          provider:
            "MICROSOFT",
          connectorAccountId:
            account.id,
          providerCalendarId:
            calendar.id,
          displayName:
            calendar.name,
          writable:
            calendar.writable,
          isPrimary:
            calendar.primary,
          accessRole:
            calendar.writable
              ? "writer"
              : "reader",
          syncState:
            "CONNECTED",
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: [
            calendarSource
              .workspaceId,
            calendarSource
              .provider,
            calendarSource
              .providerCalendarId
          ],
          set: {
            connectorAccountId:
              account.id,
            displayName:
              calendar.name,
            writable:
              calendar.writable,
            isPrimary:
              calendar.primary,
            accessRole:
              calendar.writable
                ? "writer"
                : "reader",
            syncState:
              "CONNECTED",
            updatedAt: now
          }
        })
        .returning({
          id:
            calendarSource.id
        });

    if (
      calendar.primary &&
      source
    ) {
      primaryCalendarSourceId =
        source.id;
    }
  }

  return {
    connectorAccountId:
      account.id,
    calendarsDiscovered:
      input.calendars.length,
    writableCalendars,
    primaryCalendarSourceId
  };
}

export async function getMicrosoftConnection(
  db: SkrivebordDatabase,
  workspaceId: string
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
          )
        )
      )
      .limit(1);

  if (!account) {
    return undefined;
  }

  const sources =
    await db
      .select()
      .from(calendarSource)
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
      );

  return {
    account,
    sources
  };
}
