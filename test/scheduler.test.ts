import { describe, it, expect } from "vitest";
import { schedule } from "../src/scheduler.js";
import type { SchedulerInput, IntervalsEvent, Config } from "../src/types.js";

const BASE_CONFIG: Config = {
  weight_training: {
    name: "Strength",
    duration_minutes: 60,
    description: "Squat, deadlift, etc.",
  },
  low_cadence: {
    name: "Low Cadence Intervals",
    duration_minutes: 60,
    description: "4x10min at 60rpm",
  },
  scheduling: {
    tsb_fresh: 5,
    tsb_fatigued: -10,
    weight_sessions: 2,
    min_weight_gap_days: 2,
  },
};

function makeInput(overrides: Partial<SchedulerInput> = {}): SchedulerInput {
  return {
    startDate: "2026-04-20",
    existingEvents: [],
    trainingLoad: { ctl: 50, atl: 45, tsb: 5 },
    xertInfo: {
      ftp: 250,
      ltp: 210,
      hie: 22,
      pp: 1100,
      training_status: "Fresh",
      focus: "Endurance",
    },
    config: BASE_CONFIG,
    ...overrides,
  };
}

describe("schedule", () => {
  it("returns exactly 7 days of output", () => {
    const result = schedule(makeInput());
    expect(result).toHaveLength(7);
    expect(result[0].date).toBe("2026-04-20");
    expect(result[6].date).toBe("2026-04-26");
  });

  it("includes exactly 1 low cadence session", () => {
    const result = schedule(makeInput());
    const lc = result.filter((w) => w.type === "low_cadence");
    expect(lc).toHaveLength(1);
  });

  it("includes exactly 2 weight training sessions", () => {
    const result = schedule(makeInput());
    const wt = result.filter((w) => w.type === "weights");
    expect(wt).toHaveLength(2);
  });

  it("includes at least 1 rest day", () => {
    const result = schedule(makeInput());
    const rest = result.filter((w) => w.type === "rest");
    expect(rest.length).toBeGreaterThanOrEqual(1);
  });

  it("spaces weight sessions at least 2 days apart", () => {
    const result = schedule(makeInput());
    const weightDays = result.map((w, i) => (w.type === "weights" ? i : -1)).filter((i) => i >= 0);
    expect(weightDays).toHaveLength(2);
    expect(weightDays[1] - weightDays[0]).toBeGreaterThanOrEqual(2);
  });

  it("does not schedule back-to-back hard days", () => {
    const result = schedule(makeInput());
    for (let i = 1; i < result.length; i++) {
      const prev = result[i - 1];
      const curr = result[i];
      const prevHard = prev.intensity === "hard";
      const currHard = curr.intensity === "hard";
      if (prevHard && currHard) {
        throw new Error(
          `Back-to-back hard days: ${prev.date} (${prev.type}) and ${curr.date} (${curr.type})`,
        );
      }
    }
  });

  it("respects existing events — does not overwrite them", () => {
    const existing: IntervalsEvent[] = [
      {
        id: 1,
        start_date_local: "2026-04-21",
        name: "Group Ride",
        category: "WORKOUT",
        type: "Ride",
      },
    ];
    const result = schedule(makeInput({ existingEvents: existing }));
    const tue = result.find((w) => w.date === "2026-04-21");
    // Should not be overwritten — no planned workout on that day
    expect(tue).toBeUndefined();
  });

  it("schedules easy rides when fatigued (low TSB)", () => {
    const result = schedule(
      makeInput({
        trainingLoad: { ctl: 50, atl: 70, tsb: -15 },
      }),
    );
    const cycling = result.filter((w) => w.type === "cycling");
    for (const ride of cycling) {
      expect(ride.intensity).toBe("easy");
    }
  });
});
