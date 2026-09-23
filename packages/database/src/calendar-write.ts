import type {
  CalendarSyncEvent
} from "@skrivebord/connectors";
import {
  and,
  eq,
  sql
} from "drizzle-orm";
import type {
  SkrivebordDatabase
} from "./client";
import {
  calendarEvent,
  calendarSource
} from "./schema";

export type CalendarMoveScope =
  | "OCCURRENCE"
  | "SERIES";

export type CalendarMoveTarget = {
  requestedEventId: string;
  requestedStartAt?: Date;
  requestedEndAt?: Date;
  localTargetEventId: string;
  calendarSourceId: string;
  connectorAccountId: string;
  provider: string;
  providerCalendarId: string;
  providerEventId: string;
  providerVersion?: string;
  title: string;
  description?: string;
  startAt?: Date;
  endAt?: Date;
  timezone?: string;
  recurrenceRule?: string;
  recurrenceMasterId?: string;
  allDay: boolean;
  status: string;
  writable: boolean;
  syncState: string;
};

async function loadEventWithSource(
  db: SkrivebordDatabase,
  workspaceId: string,
  localEventId: string
) {
  const [row] = await db
    .select({
      id: calendarEvent.id,
      workspaceId:
        calendarEvent.workspaceId,
      calendarSourceId:
        calendarEvent.calendarSourceId,
      providerEventId:
        calendarEvent.providerEventId,
      providerVersion:
        calendarEvent.providerVersion,
      title: calendarEvent.title,
      description:
        calendarEvent.descriptionSanitized,
      startAt:
        calendarEvent.startAt,
      endAt:
        calendarEvent.endAt,
      timezone:
        calendarEvent.timezone,
      recurrenceMasterId:
        calendarEvent.recurrenceMasterId,
      recurrenceRule:
        calendarEvent.recurrenceRule,
      allDay:
        calendarEvent.allDay,
      status:
        calendarEvent.status,
      provider:
        calendarSource.provider,
      providerCalendarId:
        calendarSource.providerCalendarId,
      connectorAccountId:
        calendarSource.connectorAccountId,
      writable:
        calendarSource.writable,
      syncState:
        calendarSource.syncState
    })
    .from(calendarEvent)
    .innerJoin(
      calendarSource,
      eq(
        calendarEvent.calendarSourceId,
        calendarSource.id
      )
    )
    .where(
      and(
        eq(
          calendarEvent.workspaceId,
          workspaceId
        ),
        eq(
          calendarEvent.id,
          localEventId
        )
      )
    )
    .limit(1);

  return row;
}

export async function getCalendarMoveTarget(
  db: SkrivebordDatabase,
  input: {
    workspaceId: string;
    eventId: string;
    scope: CalendarMoveScope;
  }
): Promise<
  CalendarMoveTarget | undefined
> {
  const requested =
    await loadEventWithSource(
      db,
      input.workspaceId,
      input.eventId
    );

  if (
    !requested ||
    !requested.connectorAccountId
  ) {
    return undefined;
  }

  let target = requested;

  if (
    input.scope === "SERIES" &&
    requested.recurrenceMasterId
  ) {
    const [master] = await db
      .select({
        id: calendarEvent.id
      })
      .from(calendarEvent)
      .where(
        and(
          eq(
            calendarEvent.workspaceId,
            input.workspaceId
          ),
          eq(
            calendarEvent.calendarSourceId,
            requested.calendarSourceId
          ),
          eq(
            calendarEvent.providerEventId,
            requested.recurrenceMasterId
          )
        )
      )
      .limit(1);

    if (!master) {
      return undefined;
    }

    const loadedMaster =
      await loadEventWithSource(
        db,
        input.workspaceId,
        master.id
      );

    if (!loadedMaster) {
      return undefined;
    }

    target = loadedMaster;
  }

  return {
    requestedEventId:
      requested.id,
    requestedStartAt:
      requested.startAt ??
      undefined,
    requestedEndAt:
      requested.endAt ??
      undefined,
    localTargetEventId:
      target.id,
    calendarSourceId:
      target.calendarSourceId,
    connectorAccountId:
      target.connectorAccountId!,
    provider:
      target.provider,
    providerCalendarId:
      target.providerCalendarId,
    providerEventId:
      target.providerEventId,
    providerVersion:
      target.providerVersion ??
      undefined,
    title: target.title,
    description:
      target.description ??
      undefined,
    startAt:
      target.startAt ??
      undefined,
    endAt:
      target.endAt ??
      undefined,
    timezone:
      target.timezone ??
      undefined,
    recurrenceRule:
      target.recurrenceRule ??
      undefined,
    recurrenceMasterId:
      target.recurrenceMasterId ??
      undefined,
    allDay: target.allDay,
    status: target.status,
    writable: target.writable,
    syncState:
      target.syncState
  };
}

export async function persistCalendarWriteResult(
  db: SkrivebordDatabase,
  input: {
    workspaceId: string;
    localTargetEventId: string;
    providerResult: CalendarSyncEvent;
    now?: Date;
  }
): Promise<void> {
  const now = input.now ?? new Date();

  const rows = await db
    .update(calendarEvent)
    .set({
      providerVersion:
        input.providerResult
          .providerVersion,
      title:
        input.providerResult.title,
      descriptionSanitized:
        input.providerResult
          .descriptionSanitized,
      startAt:
        input.providerResult.startAt
          ? new Date(
              input.providerResult
                .startAt
            )
          : null,
      endAt:
        input.providerResult.endAt
          ? new Date(
              input.providerResult
                .endAt
            )
          : null,
      startDate:
        input.providerResult
          .startDate,
      endDate:
        input.providerResult.endDate,
      allDay:
        input.providerResult.allDay,
      timezone:
        input.providerResult.timezone,
      recurrenceMasterId:
        input.providerResult
          .recurrenceMasterId,
      recurrenceRule:
        input.providerResult
          .recurrenceRule,
      status:
        input.providerResult.status,
      sourceUpdatedAt:
        input.providerResult
          .sourceUpdatedAt
          ? new Date(
              input.providerResult
                .sourceUpdatedAt
            )
          : now,
      normalizedAt: now,
      localVersion:
        sql`${calendarEvent.localVersion} + 1`,
      updatedAt: now
    })
    .where(
      and(
        eq(
          calendarEvent.workspaceId,
          input.workspaceId
        ),
        eq(
          calendarEvent.id,
          input.localTargetEventId
        )
      )
    )
    .returning({
      id: calendarEvent.id
    });

  if (rows.length !== 1) {
    throw new Error(
      "CALENDAR_EVENT_WRITE_PERSIST_FAILED"
    );
  }
}
