import { createHash } from "node:crypto";
import type { SkrivebordDatabase } from "./client";
import {
  booking,
  calendarEvent,
  calendarSource,
  property,
  yearPlanItem
} from "./schema";

function stableUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  const chars = hex.split("");
  chars[12] = "4";
  chars[16] = ((parseInt(chars[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = chars.join("");
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20, 32)
  ].join("-");
}

function copenhagenMonthDay(now: Date): {
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen",
    month: "numeric",
    day: "numeric"
  }).formatToParts(now);

  return {
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value)
  };
}

export async function seedAlsLebenPilotData(
  db: SkrivebordDatabase,
  workspaceId: string,
  now = new Date()
): Promise<void> {
  const harborPropertyId = stableUuid(`${workspaceId}:property:harbor`);
  const forestPropertyId = stableUuid(`${workspaceId}:property:forest`);

  await db
    .insert(property)
    .values([
      {
        id: harborPropertyId,
        workspaceId,
        name: "Havnehuset",
        timezone: "Europe/Copenhagen"
      },
      {
        id: forestPropertyId,
        workspaceId,
        name: "Skovhuset",
        timezone: "Europe/Copenhagen"
      }
    ])
    .onConflictDoNothing();

  const arrivalOne = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const departureOne = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000);
  const arrivalTwo = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
  const departureTwo = new Date(now.getTime() + 9 * 24 * 60 * 60 * 1000);
  const arrivalThree = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const departureThree = new Date(now.getTime() + 11 * 24 * 60 * 60 * 1000);

  await db
    .insert(booking)
    .values([
      {
        id: stableUuid(`${workspaceId}:booking:anna`),
        workspaceId,
        propertyId: harborPropertyId,
        externalSource: "PILOT",
        externalId: "alsleben-anna",
        guestDisplayName: "Anna Jensen",
        checkInAt: arrivalOne,
        checkOutAt: departureOne,
        status: "ACTIVE"
      },
      {
        id: stableUuid(`${workspaceId}:booking:martin`),
        workspaceId,
        propertyId: harborPropertyId,
        externalSource: "PILOT",
        externalId: "alsleben-martin",
        guestDisplayName: "Martin Holm",
        checkInAt: arrivalTwo,
        checkOutAt: departureTwo,
        status: "ACTIVE"
      },
      {
        id: stableUuid(`${workspaceId}:booking:sara`),
        workspaceId,
        propertyId: forestPropertyId,
        externalSource: "PILOT",
        externalId: "alsleben-sara",
        guestDisplayName: "Sara Lund",
        checkInAt: arrivalThree,
        checkOutAt: departureThree,
        status: "ACTIVE"
      }
    ])
    .onConflictDoNothing();

  const sourceId = stableUuid(`${workspaceId}:calendar-source:operations`);

  await db
    .insert(calendarSource)
    .values({
      id: sourceId,
      workspaceId,
      provider: "SKRIVEBORD",
      providerCalendarId: "operations",
      displayName: "Drift",
      writable: true,
      syncState: "HEALTHY",
      lastSyncedAt: now
    })
    .onConflictDoNothing();

  await db
    .insert(calendarEvent)
    .values([
      {
        id: stableUuid(`${workspaceId}:calendar:cleaning`),
        workspaceId,
        calendarSourceId: sourceId,
        providerEventId: "pilot-cleaning",
        title: "Rengøring · Havnehuset",
        startAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        endAt: new Date(now.getTime() + 26 * 60 * 60 * 1000),
        allDay: false,
        timezone: "Europe/Copenhagen",
        category: "TURNOVER",
        propertyId: harborPropertyId,
        originActorType: "SYSTEM",
        originActorId: "pilot-seed",
        sourceUpdatedAt: now
      },
      {
        id: stableUuid(`${workspaceId}:calendar:arrival-anna`),
        workspaceId,
        calendarSourceId: sourceId,
        providerEventId: "pilot-arrival-anna",
        title: "Anna Jensen ankommer",
        startAt: arrivalOne,
        endAt: new Date(arrivalOne.getTime() + 60 * 60 * 1000),
        allDay: false,
        timezone: "Europe/Copenhagen",
        category: "BOOKING",
        propertyId: harborPropertyId,
        bookingId: stableUuid(`${workspaceId}:booking:anna`),
        originActorType: "SYSTEM",
        originActorId: "pilot-seed",
        sourceUpdatedAt: now
      },
      {
        id: stableUuid(`${workspaceId}:calendar:heat-pump`),
        workspaceId,
        calendarSourceId: sourceId,
        providerEventId: "pilot-heat-pump",
        title: "Service på varmepumpe",
        startAt: new Date(now.getTime() + 72 * 60 * 60 * 1000),
        endAt: new Date(now.getTime() + 74 * 60 * 60 * 1000),
        allDay: false,
        timezone: "Europe/Copenhagen",
        category: "MAINTENANCE",
        propertyId: forestPropertyId,
        originActorType: "SYSTEM",
        originActorId: "pilot-seed",
        sourceUpdatedAt: now
      }
    ])
    .onConflictDoNothing();

  const { month, day } = copenhagenMonthDay(now);

  await db
    .insert(yearPlanItem)
    .values({
      id: stableUuid(`${workspaceId}:yearplan:winter-terrace`),
      workspaceId,
      moduleId: "rental",
      propertyId: harborPropertyId,
      title: "Vinterklargør terrasse",
      description:
        "Terrassen skal gennemgås og klargøres før efterårsvejret.",
      month,
      windowStartDay: Math.max(1, day - 3),
      windowEndDay: Math.min(31, day + 7),
      active: true
    })
    .onConflictDoNothing();
}
