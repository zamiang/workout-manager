import { describe, it, expect } from "vitest";
import { parseArgs, formatPlan, workoutToEvent, computeWeeklyRampPct } from "../src/cli.js";
import type { PlannedWorkout, WellnessEntry } from "../src/types.js";

describe("parseArgs", () => {
  it("parses 'plan' command", () => {
    const result = parseArgs(["plan"]);
    expect(result).toEqual({ command: "plan", dryRun: false });
  });

  it("parses 'plan --dry-run' command", () => {
    const result = parseArgs(["plan", "--dry-run"]);
    expect(result).toEqual({ command: "plan", dryRun: true });
  });

  it("parses 'status' command", () => {
    const result = parseArgs(["status"]);
    expect(result).toEqual({ command: "status", dryRun: false });
  });

  it("throws on unknown command", () => {
    expect(() => parseArgs(["foo"])).toThrow("Unknown command");
  });

  it("throws on no command", () => {
    expect(() => parseArgs([])).toThrow("No command");
  });
});

describe("formatPlan", () => {
  const week: PlannedWorkout[] = [
    {
      date: "2026-04-20",
      type: "cycling",
      name: "Hard Ride",
      description: "Threshold intervals",
      intensity: "hard",
    },
    {
      date: "2026-04-21",
      type: "weights",
      name: "Strength",
      description: "Squats and stuff",
      intensity: "hard",
    },
    {
      date: "2026-04-22",
      type: "low_cadence",
      name: "Low Cadence Intervals",
      description: "4x10 at 60rpm",
      intensity: "hard",
    },
    {
      date: "2026-04-23",
      type: "rest",
      name: "Rest Day",
      description: "Recovery",
      intensity: "easy",
    },
  ];

  it("formats one line per workout with date and name", () => {
    const out = formatPlan(week);
    const lines = out.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("2026-04-20");
    expect(lines[0]).toContain("Hard Ride");
    expect(lines[0]).toContain("hard");
  });

  it("uses a distinct icon per workout type", () => {
    const out = formatPlan(week);
    expect(out).toContain("[CY]"); // cycling
    expect(out).toContain("[WT]"); // weights
    expect(out).toContain("[LC]"); // low_cadence
    expect(out).toMatch(/\[ {2}\]/); // rest — two spaces
  });

  it("includes an abbreviated day-of-week for each date", () => {
    const out = formatPlan([week[0]]);
    // 2026-04-20 is a Monday
    expect(out).toContain("Mon");
  });

  it("returns an empty string for an empty plan", () => {
    expect(formatPlan([])).toBe("");
  });
});

describe("computeWeeklyRampPct", () => {
  function w(date: string, ctl: number): WellnessEntry {
    return { date, ctl, atl: 0, tsb: 0 };
  }

  it("returns undefined for an empty range", () => {
    expect(computeWeeklyRampPct([])).toBeUndefined();
  });

  it("returns undefined when the oldest CTL is zero", () => {
    expect(computeWeeklyRampPct([w("2026-04-19", 0), w("2026-04-26", 50)])).toBeUndefined();
  });

  it("computes ramp as (newest - oldest) / oldest * 100", () => {
    expect(computeWeeklyRampPct([w("2026-04-19", 50), w("2026-04-26", 53.5)])).toBeCloseTo(7, 5);
    expect(computeWeeklyRampPct([w("2026-04-19", 50), w("2026-04-26", 55)])).toBeCloseTo(10, 5);
  });

  it("handles entries arriving in any date order", () => {
    expect(computeWeeklyRampPct([w("2026-04-26", 55), w("2026-04-19", 50)])).toBeCloseTo(10, 5);
  });
});

describe("workoutToEvent", () => {
  it("maps cycling to a Ride workout", () => {
    const event = workoutToEvent({
      date: "2026-04-20",
      type: "cycling",
      name: "Hard Ride",
      description: "threshold",
      intensity: "hard",
    });
    expect(event).toEqual({
      start_date_local: "2026-04-20",
      name: "Hard Ride",
      category: "WORKOUT",
      type: "Ride",
      description: "threshold",
    });
  });

  it("maps low_cadence to a Ride workout", () => {
    const event = workoutToEvent({
      date: "2026-04-22",
      type: "low_cadence",
      name: "LC",
      description: "",
      intensity: "hard",
    });
    expect(event.type).toBe("Ride");
    expect(event.category).toBe("WORKOUT");
  });

  it("maps weights to WeightTraining", () => {
    const event = workoutToEvent({
      date: "2026-04-21",
      type: "weights",
      name: "Strength",
      description: "",
      intensity: "hard",
    });
    expect(event.type).toBe("WeightTraining");
    expect(event.category).toBe("WORKOUT");
  });

  it("maps rest to a NOTE category", () => {
    const event = workoutToEvent({
      date: "2026-04-23",
      type: "rest",
      name: "Rest Day",
      description: "Recovery",
      intensity: "easy",
    });
    expect(event.category).toBe("NOTE");
    expect(event.type).toBe("Note");
  });
});
