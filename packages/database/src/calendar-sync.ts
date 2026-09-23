import type { CalendarSyncResult } from "@skrivebord/connectors";
import {
  and,
  eq,
  inArray
} from "drizzle-orm";
import type { SkrivebordDatabase } from "./client";
import {
  calendarEvent,
  calendarSource,
  connectorAccount,
  syncCursor,
  syncRun
} from "./schema";

export type PersistCalendarSyncInput = {
  workspaceId: string;
  connectorAccountId: string;
  calendarSourceId: string;
  resourceScope: string;
  provider: "GOOGLE" | "MICROSOFT";
  mode: "INITIAL" | "INCREMENTAL";
  result: CalendarSyncResult;
  protectCursor: (rawCursor: string) => Promise<string> | string;
  replaceSeriesMasterIds?: string[];
  now?: Date;
};

export type PersistCalendarSyncResult = {
  applied: boolean;
  fullResyncRequired: boolean;
  itemsSeen: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsDeleted: number;
};

export async function persistCalendarSync(
  db: SkrivebordDatabase,
  input: PersistCalendarSyncInput
): Promise<PersistCalendarSyncResult> {
  if (input.result.fullResyncRequired) {
    return {
      applied: false,
      fullResyncRequired: true,
      itemsSeen: 0,
      itemsCreated: 0,
      itemsUpdated: 0,
      itemsDeleted: 0
    };
  }

  if (!input.result.cursor) {
    throw new Error("SYNC_CURSOR_REQUIRED");
  }

  const now = input.now ?? new Date();
  const [run] = await db
    .insert(syncRun)
    .values({
      workspaceId: input.workspaceId,
      connectorAccountId: input.connectorAccountId,
      mode: input.mode,
      status: "RUNNING",
      startedAt: now
    })
    .returning({ id: syncRun.id });

  if (!run) {
    throw new Error("SYNC_RUN_CREATE_FAILED");
  }

  let itemsCreated = 0;
  let itemsUpdated = 0;
  let itemsDeleted = 0;

  const replaceSeriesMasterIds =
    [
      ...new Set(
        input
          .replaceSeriesMasterIds ??
        []
      )
    ];

  if (
    replaceSeriesMasterIds.length >
    0
  ) {
    await db
      .delete(calendarEvent)
      .where(
        and(
          eq(
            calendarEvent.workspaceId,
            input.workspaceId
          ),
          eq(
            calendarEvent.calendarSourceId,
            input.calendarSourceId
          ),
          inArray(
            calendarEvent
              .recurrenceMasterId,
            replaceSeriesMasterIds
          )
        )
      );
  }

  for (const event of input.result.events) {
    const [existing] = await db
      .select({
        id: calendarEvent.id,
        status: calendarEvent.status
      })
      .from(calendarEvent)
      .where(
        and(
          eq(calendarEvent.workspaceId, input.workspaceId),
          eq(calendarEvent.calendarSourceId, input.calendarSourceId),
          eq(calendarEvent.providerEventId, event.providerEventId)
        )
      )
      .limit(1);

    if (!existing) {
      itemsCreated += 1;
    } else if (event.status === "CANCELLED") {
      itemsDeleted += 1;
    } else {
      itemsUpdated += 1;
    }

    await db
      .insert(calendarEvent)
      .values({
        workspaceId: input.workspaceId,
        calendarSourceId: input.calendarSourceId,
        providerEventId: event.providerEventId,
        providerVersion: event.providerVersion,
        title: event.title,
        descriptionSanitized: event.descriptionSanitized,
        startAt: event.startAt ? new Date(event.startAt) : null,
        endAt: event.endAt ? new Date(event.endAt) : null,
        startDate: event.startDate,
        endDate: event.endDate,
        allDay: event.allDay,
        timezone: event.timezone,
        recurrenceMasterId: event.recurrenceMasterId,
        recurrenceOriginalStartAt:
          event.recurrenceOriginalStartAt
            ? new Date(
                event.recurrenceOriginalStartAt
              )
            : null,
        recurrenceRule: event.recurrenceRule,
        status: event.status,
        category: "EXTERNAL",
        originActorType: "SYSTEM",
        originActorId: `connector:${input.provider.toLowerCase()}`,
        sourceUpdatedAt: event.sourceUpdatedAt
          ? new Date(event.sourceUpdatedAt)
          : null,
        normalizedAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: [
          calendarEvent.workspaceId,
          calendarEvent.calendarSourceId,
          calendarEvent.providerEventId
        ],
        set: {
          providerVersion: event.providerVersion,
          title: event.title,
          descriptionSanitized: event.descriptionSanitized,
          startAt: event.startAt ? new Date(event.startAt) : null,
          endAt: event.endAt ? new Date(event.endAt) : null,
          startDate: event.startDate,
          endDate: event.endDate,
          allDay: event.allDay,
          timezone: event.timezone,
          recurrenceMasterId: event.recurrenceMasterId,
          recurrenceOriginalStartAt:
            event.recurrenceOriginalStartAt
              ? new Date(
                  event.recurrenceOriginalStartAt
                )
              : null,
          recurrenceRule: event.recurrenceRule,
          status: event.status,
          sourceUpdatedAt: event.sourceUpdatedAt
            ? new Date(event.sourceUpdatedAt)
            : null,
          normalizedAt: now,
          updatedAt: now
        }
      });
  }

  const protectedCursor = await input.protectCursor(
    input.result.cursor.value
  );

  await db
    .insert(syncCursor)
    .values({
      workspaceId: input.workspaceId,
      connectorAccountId: input.connectorAccountId,
      resourceType: "CALENDAR_EVENTS",
      resourceScope: input.resourceScope,
      cursorType: input.result.cursor.type,
      cursorValueProtected: protectedCursor,
      validFrom: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: [
        syncCursor.workspaceId,
        syncCursor.connectorAccountId,
        syncCursor.resourceType,
        syncCursor.resourceScope
      ],
      set: {
        cursorType: input.result.cursor.type,
        cursorValueProtected: protectedCursor,
        validFrom: now,
        updatedAt: now
      }
    });

  await db
    .update(calendarSource)
    .set({
      syncState: "HEALTHY",
      lastSyncedAt: now,
      updatedAt: now
    })
    .where(
      and(
        eq(calendarSource.id, input.calendarSourceId),
        eq(calendarSource.workspaceId, input.workspaceId)
      )
    );

  await db
    .update(connectorAccount)
    .set({
      status: "HEALTHY",
      lastSuccessAt: now,
      lastErrorCode: null,
      updatedAt: now
    })
    .where(
      and(
        eq(connectorAccount.id, input.connectorAccountId),
        eq(connectorAccount.workspaceId, input.workspaceId)
      )
    );

  await db
    .update(syncRun)
    .set({
      status: "SUCCEEDED",
      completedAt: now,
      itemsSeen: input.result.events.length,
      itemsCreated,
      itemsUpdated,
      itemsDeleted
    })
    .where(
      and(
        eq(syncRun.id, run.id),
        eq(syncRun.workspaceId, input.workspaceId)
      )
    );

  return {
    applied: true,
    fullResyncRequired: false,
    itemsSeen: input.result.events.length,
    itemsCreated,
    itemsUpdated,
    itemsDeleted
  };
}

export async function clearCalendarSourceForFullResync(
  db: SkrivebordDatabase,
  input: {
    workspaceId: string;
    connectorAccountId: string;
    calendarSourceId: string;
    resourceScope: string;
    now?: Date;
  }
): Promise<void> {
  const now = input.now ?? new Date();

  await db
    .delete(calendarEvent)
    .where(
      and(
        eq(calendarEvent.workspaceId, input.workspaceId),
        eq(calendarEvent.calendarSourceId, input.calendarSourceId)
      )
    );

  await db
    .delete(syncCursor)
    .where(
      and(
        eq(syncCursor.workspaceId, input.workspaceId),
        eq(syncCursor.connectorAccountId, input.connectorAccountId),
        eq(syncCursor.resourceType, "CALENDAR_EVENTS"),
        eq(syncCursor.resourceScope, input.resourceScope)
      )
    );

  await db
    .update(calendarSource)
    .set({
      syncState: "SYNCING",
      updatedAt: now
    })
    .where(
      and(
        eq(calendarSource.id, input.calendarSourceId),
        eq(calendarSource.workspaceId, input.workspaceId)
      )
    );
}
