import { and, desc, eq, ne } from "drizzle-orm";
import type { SkrivebordDatabase } from "./client";
import {
  actionIntent,
  auditEvent,
  calendarEvent,
  calendarSource,
  workItem,
  yearPlanItem
} from "./schema";

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
      approvalId: auditEvent.approvalId
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
  return db
    .select({
      id: calendarEvent.id,
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
    .where(eq(calendarEvent.workspaceId, workspaceId));
}
