import { describe, it, expect } from "vitest";
import { toLocalISODate, addLocalDays } from "../src/dates.js";

describe("toLocalISODate", () => {
  it("formats a Date as its local YYYY-MM-DD", () => {
    // Construct from local components so the assertion is timezone-independent.
    expect(toLocalISODate(new Date(2026, 5, 9))).toBe("2026-06-09"); // month is 0-based
  });

  it("zero-pads month and day", () => {
    expect(toLocalISODate(new Date(2026, 0, 3))).toBe("2026-01-03");
  });
});

describe("addLocalDays", () => {
  it("advances across a month boundary", () => {
    expect(addLocalDays("2026-06-29", 6)).toBe("2026-07-05");
  });

  it("goes backwards with a negative offset", () => {
    expect(addLocalDays("2026-06-09", -7)).toBe("2026-06-02");
  });

  it("is a no-op for zero", () => {
    expect(addLocalDays("2026-06-09", 0)).toBe("2026-06-09");
  });
});
