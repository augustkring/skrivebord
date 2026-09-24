import { describe, expect, it } from "vitest";
import {
  CreateCalendarEventInputSchema
} from "./calendar-actions";

const base = {
  workspaceId: "workspace-a",
  calendarSourceId:
    "11111111-1111-4111-8111-111111111111",
  title: "Service"
};

describe("calendar create command", () => {
  it("accepts a valid timed event", () => {
    expect(
      CreateCalendarEventInputSchema.safeParse({
        ...base,
        timing: {
          kind: "TIMED",
          startsAt:
            "2026-09-25T09:00:00+02:00",
          endsAt:
            "2026-09-25T10:00:00+02:00",
          timezone:
            "Europe/Copenhagen"
        }
      }).success
    ).toBe(true);
  });

  it("rejects a timed event where end is not after start", () => {
    expect(
      CreateCalendarEventInputSchema.safeParse({
        ...base,
        timing: {
          kind: "TIMED",
          startsAt:
            "2026-09-25T10:00:00+02:00",
          endsAt:
            "2026-09-25T09:00:00+02:00"
        }
      }).success
    ).toBe(false);
  });

  it("accepts date-only all-day semantics with exclusive end date", () => {
    expect(
      CreateCalendarEventInputSchema.safeParse({
        ...base,
        timing: {
          kind: "ALL_DAY",
          startDate:
            "2026-12-24",
          endDate:
            "2026-12-25"
        }
      }).success
    ).toBe(true);
  });

  it("rejects an all-day event without a later exclusive end date", () => {
    expect(
      CreateCalendarEventInputSchema.safeParse({
        ...base,
        timing: {
          kind: "ALL_DAY",
          startDate:
            "2026-12-24",
          endDate:
            "2026-12-24"
        }
      }).success
    ).toBe(false);
  });
});
