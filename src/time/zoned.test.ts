import { describe, expect, test } from "bun:test";
import { addCalendarDays, localDateTimeAt, resolveLocalDateTime } from "./zoned";

describe("zoned local time", () => {
  test("resolves Warsaw summer time deterministically", () => {
    const result = resolveLocalDateTime("2026-08-21", "13:00", "Europe/Warsaw");
    expect(result).toEqual({
      ok: true,
      epochMs: Date.parse("2026-08-21T13:00:00+02:00"),
    });
    if (result.ok) {
      expect(localDateTimeAt(result.epochMs, "Europe/Warsaw")).toEqual({
        date: "2026-08-21",
        time: "13:00",
      });
    }
  });

  test("rejects impossible calendar dates", () => {
    expect(resolveLocalDateTime("2026-02-31", "13:00", "Europe/Warsaw").ok).toBe(false);
  });

  test("rejects a wall-clock time skipped by the DST spring transition", () => {
    const result = resolveLocalDateTime("2026-03-29", "02:30", "Europe/Warsaw");
    expect(result.ok).toBe(false);
  });

  test("adds days using calendar dates instead of fixed 24-hour durations", () => {
    expect(addCalendarDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
