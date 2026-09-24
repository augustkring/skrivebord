import { describe, expect, it } from "vitest";
import {
  toLocalInput,
  wallTimeToIso
} from "./calendar-local-time";

describe("calendar local time conversion", () => {
  it("round-trips Europe/Copenhagen wall time", () => {
    const iso =
      wallTimeToIso(
        "2026-09-24T15:30",
        "Europe/Copenhagen"
      );

    expect(iso).toBe(
      "2026-09-24T13:30:00.000Z"
    );

    expect(
      toLocalInput(
        iso,
        "Europe/Copenhagen"
      )
    ).toBe(
      "2026-09-24T15:30"
    );
  });

  it("rejects nonexistent DST wall time", () => {
    expect(() =>
      wallTimeToIso(
        "2026-03-29T02:30",
        "Europe/Copenhagen"
      )
    ).toThrow(
      "LOCAL_TIME_DOES_NOT_EXIST"
    );
  });

  it("rejects malformed local time", () => {
    expect(() =>
      wallTimeToIso(
        "24/09/2026 15:30",
        "Europe/Copenhagen"
      )
    ).toThrow(
      "INVALID_LOCAL_TIME"
    );
  });
});
