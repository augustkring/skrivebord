import { createHash } from "node:crypto";
import type { WorkItem as DomainWorkItem } from "@skrivebord/contracts";
import {
  buildTodayView,
  type OperationalSnapshot
} from "@skrivebord/domain";
import { and, eq, ne } from "drizzle-orm";
import type { SkrivebordDatabase } from "./client";
import {
  booking,
  workItem,
  yearPlanItem
} from "./schema";

function fingerprint(item: DomainWorkItem): string {
  const evidence = item.evidence
    .map((entry) => [entry.kind, entry.id ?? "", entry.label].join(":"))
    .sort()
    .join("|");

  return createHash("sha256")
    .update([
      item.workspaceId,
      item.kind,
      item.recommendedActionId,
      evidence
    ].join("::"))
    .digest("hex");
}

export async function loadOperationalSnapshot(
  db: SkrivebordDatabase,
  workspaceId: string
): Promise<OperationalSnapshot> {
  const bookingRows = await db
    .select()
    .from(booking)
    .where(eq(booking.workspaceId, workspaceId));

  const yearPlanRows = await db
    .select()
    .from(yearPlanItem)
    .where(
      and(
        eq(yearPlanItem.workspaceId, workspaceId),
        eq(yearPlanItem.active, true)
      )
    );

  return {
    workspaceId,
    connectorHealthy: false,
    bookings: bookingRows.map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      propertyId: row.propertyId,
      guestDisplayName: row.guestDisplayName,
      checkInAt: row.checkInAt.toISOString(),
      checkOutAt: row.checkOutAt.toISOString(),
      status: row.status as "ACTIVE" | "CANCELLED" | "COMPLETED"
    })),
    calendarEvents: [],
    yearPlanItems: yearPlanRows.map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      propertyId: row.propertyId ?? undefined,
      title: row.title,
      description: row.description,
      month: row.month,
      windowStartDay: row.windowStartDay,
      windowEndDay: row.windowEndDay,
      windowLabel: `${row.windowStartDay}.–${row.windowEndDay}. måned ${row.month}`,
      active: row.active
    })),
    activity: []
  };
}

function flattenCandidates(
  view: ReturnType<typeof buildTodayView>
): DomainWorkItem[] {
  const bySourceId = new Map<string, DomainWorkItem>();

  for (const item of [
    ...view.requiresYou,
    ...view.today,
    ...view.upcoming,
    ...view.thisMonth
  ]) {
    bySourceId.set(item.id, item);
  }

  return [...bySourceId.values()];
}

export async function recomputeToday(
  db: SkrivebordDatabase,
  workspaceId: string,
  now: Date
): Promise<void> {
  const snapshot = await loadOperationalSnapshot(db, workspaceId);
  const candidates = flattenCandidates(buildTodayView(snapshot, now));

  const currentRows = await db
    .select()
    .from(workItem)
    .where(eq(workItem.workspaceId, workspaceId));

  const existingByFingerprint = new Map(
    currentRows.map((row) => [row.dedupeFingerprint, row])
  );

  const activeFingerprints = new Set<string>();

  for (const candidate of candidates) {
    const dedupeFingerprint = fingerprint(candidate);
    activeFingerprints.add(dedupeFingerprint);
    const existing = existingByFingerprint.get(dedupeFingerprint);

    if (existing) {
      if (
        existing.status === "DONE" ||
        existing.status === "DISMISSED"
      ) {
        continue;
      }

      await db
        .update(workItem)
        .set({
          kind: candidate.kind,
          title: candidate.title,
          reason: candidate.reason,
          priorityClass: candidate.priorityClass,
          evidence: candidate.evidence,
          suggestedActionId: candidate.recommendedActionId,
          agentExecutionMode: candidate.agentExecutionMode,
          status: "OPEN",
          updatedAt: now
        })
        .where(
          and(
            eq(workItem.id, existing.id),
            eq(workItem.workspaceId, workspaceId)
          )
        );

      continue;
    }

    await db.insert(workItem).values({
      workspaceId,
      moduleId: candidate.kind.startsWith("BOOKING") ||
        candidate.kind.startsWith("GUEST") ||
        candidate.kind === "YEAR_PLAN"
        ? "rental"
        : "core",
      kind: candidate.kind,
      title: candidate.title,
      reason: candidate.reason,
      status: "OPEN",
      priorityClass: candidate.priorityClass,
      evidence: candidate.evidence,
      suggestedActionId: candidate.recommendedActionId,
      agentExecutionMode: candidate.agentExecutionMode,
      dedupeFingerprint
    });
  }

  for (const existing of currentRows) {
    if (
      activeFingerprints.has(existing.dedupeFingerprint) ||
      existing.status === "DONE" ||
      existing.status === "DISMISSED" ||
      existing.status === "EXPIRED"
    ) {
      continue;
    }

    await db
      .update(workItem)
      .set({
        status: "EXPIRED",
        updatedAt: now
      })
      .where(
        and(
          eq(workItem.id, existing.id),
          eq(workItem.workspaceId, workspaceId),
          ne(workItem.status, "DONE")
        )
      );
  }
}

export type PersistedTodayItem = {
  id: string;
  kind: string;
  title: string;
  reason: string;
  status: string;
  priorityClass: string;
  evidence: unknown;
  suggestedActionId: string | null;
  agentExecutionMode: string;
  completedAt: Date | null;
};

export async function listTodayItems(
  db: SkrivebordDatabase,
  workspaceId: string
): Promise<PersistedTodayItem[]> {
  return db
    .select({
      id: workItem.id,
      kind: workItem.kind,
      title: workItem.title,
      reason: workItem.reason,
      status: workItem.status,
      priorityClass: workItem.priorityClass,
      evidence: workItem.evidence,
      suggestedActionId: workItem.suggestedActionId,
      agentExecutionMode: workItem.agentExecutionMode,
      completedAt: workItem.completedAt
    })
    .from(workItem)
    .where(
      and(
        eq(workItem.workspaceId, workspaceId),
        ne(workItem.status, "EXPIRED")
      )
    );
}
