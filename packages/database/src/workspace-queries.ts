import {
  and,
  asc,
  desc,
  eq,
  ilike,
  isNotNull,
  ne
} from "drizzle-orm";
import type { SkrivebordDatabase } from "./client";
import {
  actionIntent,
  auditEvent,
  calendarEvent,
  calendarSource,
  workItem,
  workspaceProfile,
  yearPlanItem
} from "./schema";

export async function getWorkspaceProfile(
  db: SkrivebordDatabase,
  workspaceId: string
) {
  const [workspace] =
    await db
      .select()
      .from(workspaceProfile)
      .where(
        eq(
          workspaceProfile.workspaceId,
          workspaceId
        )
      )
      .limit(1);

  return workspace;
}

export async function listYearPlanItems(
  db: SkrivebordDatabase,
  workspaceId: string
) {
  return db
    .select()
    .from(yearPlanItem)
    .where(
      and(
        eq(yearPlanItem.workspaceId, workspaceId),
        eq(yearPlanItem.active, true)
      )
    );
}

export async function listAttentionItems(
  db: SkrivebordDatabase,
  workspaceId: string
) {
  return db
    .select()
    .from(workItem)
    .where(
      and(
        eq(workItem.workspaceId, workspaceId),
        eq(workItem.priorityClass, "REQUIRES_YOU"),
        ne(workItem.status, "DONE"),
        ne(workItem.status, "DISMISSED"),
        ne(workItem.status, "EXPIRED")
      )
    );
}

export async function listActivityEvents(
  db: SkrivebordDatabase,
  workspaceId: string,
  limit = 100
) {
  return db
    .select({
      id: auditEvent.id,
      occurredAt: auditEvent.occurredAt,
      actorPrincipalId: auditEvent.actorPrincipalId,
      actorType: auditEvent.actorType,
      action: auditEvent.action,
      outcome: auditEvent.outcome,
      humanSummary: actionIntent.humanSummary,
      approvalId: auditEvent.approvalId,
      metadata: auditEvent.metadata
    })
    .from(auditEvent)
    .leftJoin(
      actionIntent,
      eq(auditEvent.actionIntentId, actionIntent.id)
    )
    .where(eq(auditEvent.workspaceId, workspaceId))
    .orderBy(desc(auditEvent.occurredAt))
    .limit(limit);
}

export async function listCalendarEvents(
  db: SkrivebordDatabase,
  workspaceId: string
) {
  const rows = await db
    .select({
      id: calendarEvent.id,
      providerEventId:
        calendarEvent.providerEventId,
      title: calendarEvent.title,
      category: calendarEvent.category,
      startAt: calendarEvent.startAt,
      endAt: calendarEvent.endAt,
      startDate: calendarEvent.startDate,
      endDate: calendarEvent.endDate,
      allDay: calendarEvent.allDay,
      timezone: calendarEvent.timezone,
      recurrenceMasterId:
        calendarEvent.recurrenceMasterId,
      recurrenceRule:
        calendarEvent.recurrenceRule,
      status: calendarEvent.status,
      provider: calendarSource.provider,
      sourceName: calendarSource.displayName,
      writable: calendarSource.writable,
      syncState: calendarSource.syncState,
      lastSyncedAt: calendarSource.lastSyncedAt
    })
    .from(calendarEvent)
    .innerJoin(
      calendarSource,
      eq(calendarEvent.calendarSourceId, calendarSource.id)
    )
    .where(
      and(
        eq(
          calendarEvent.workspaceId,
          workspaceId
        ),
        ne(
          calendarEvent.status,
          "CANCELLED"
        )
      )
    );

  const expandedMasterIds =
    new Set(
      rows
        .map(
          (event) =>
            event.recurrenceMasterId
        )
        .filter(
          (
            value
          ): value is string =>
            Boolean(value)
        )
    );

  return rows.filter(
    (event) =>
      !(
        event.recurrenceRule &&
        expandedMasterIds.has(
          event.providerEventId
        )
      )
  );
}


export async function getCalendarEvent(
  db: SkrivebordDatabase,
  input: {
    workspaceId: string;
    eventId: string;
  }
) {
  const [event] = await db
    .select({
      id: calendarEvent.id,
      title: calendarEvent.title,
      category:
        calendarEvent.category,
      startAt:
        calendarEvent.startAt,
      endAt:
        calendarEvent.endAt,
      startDate:
        calendarEvent.startDate,
      endDate:
        calendarEvent.endDate,
      allDay:
        calendarEvent.allDay,
      timezone:
        calendarEvent.timezone,
      recurrenceMasterId:
        calendarEvent
          .recurrenceMasterId,
      recurrenceRule:
        calendarEvent
          .recurrenceRule,
      status:
        calendarEvent.status,
      provider:
        calendarSource.provider,
      sourceName:
        calendarSource.displayName,
      writable:
        calendarSource.writable,
      syncState:
        calendarSource.syncState,
      lastSyncedAt:
        calendarSource.lastSyncedAt
    })
    .from(calendarEvent)
    .innerJoin(
      calendarSource,
      eq(
        calendarEvent
          .calendarSourceId,
        calendarSource.id
      )
    )
    .where(
      and(
        eq(
          calendarEvent.workspaceId,
          input.workspaceId
        ),
        eq(
          calendarEvent.id,
          input.eventId
        )
      )
    )
    .limit(1);

  return event;
}

export async function searchCalendarEvents(
  db: SkrivebordDatabase,
  input: {
    workspaceId: string;
    query: string;
    limit?: number;
  }
) {
  const query =
    input.query.trim();

  if (!query) {
    return [];
  }

  const rows = await db
    .select({
      id: calendarEvent.id,
      providerEventId:
        calendarEvent.providerEventId,
      title: calendarEvent.title,
      category:
        calendarEvent.category,
      startAt:
        calendarEvent.startAt,
      endAt:
        calendarEvent.endAt,
      startDate:
        calendarEvent.startDate,
      endDate:
        calendarEvent.endDate,
      allDay:
        calendarEvent.allDay,
      timezone:
        calendarEvent.timezone,
      recurrenceMasterId:
        calendarEvent
          .recurrenceMasterId,
      recurrenceRule:
        calendarEvent
          .recurrenceRule,
      status:
        calendarEvent.status,
      provider:
        calendarSource.provider,
      sourceName:
        calendarSource.displayName,
      writable:
        calendarSource.writable,
      syncState:
        calendarSource.syncState
    })
    .from(calendarEvent)
    .innerJoin(
      calendarSource,
      eq(
        calendarEvent
          .calendarSourceId,
        calendarSource.id
      )
    )
    .where(
      and(
        eq(
          calendarEvent.workspaceId,
          input.workspaceId
        ),
        ne(
          calendarEvent.status,
          "CANCELLED"
        ),
        ilike(
          calendarEvent.title,
          `%${query}%`
        )
      )
    )
    .orderBy(
      asc(calendarEvent.startAt),
      asc(calendarEvent.startDate)
    )
    .limit(
      Math.min(
        Math.max(
          input.limit ?? 20,
          1
        ),
        100
      )
    );

  const expandedRows =
    await db
      .select({
        masterId:
          calendarEvent
            .recurrenceMasterId
      })
      .from(calendarEvent)
      .where(
        and(
          eq(
            calendarEvent.workspaceId,
            input.workspaceId
          ),
          isNotNull(
            calendarEvent
              .recurrenceMasterId
          )
        )
      );

  const expandedMasterIds =
    new Set(
      expandedRows
        .map(
          (event) =>
            event.masterId
        )
        .filter(
          (
            value
          ): value is string =>
            Boolean(value)
        )
    );

  return rows.filter(
    (event) =>
      !(
        event.recurrenceRule &&
        expandedMasterIds.has(
          event.providerEventId
        )
      )
  );
}
