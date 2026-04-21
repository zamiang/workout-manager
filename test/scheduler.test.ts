import { describe, it, expect } from "vitest";
import { schedule, classifyFatigue } from "../src/scheduler.js";
import type { SchedulerInput, IntervalsEvent, Config, PlannedWorkout } from "../src/types.js";

function isHardEntry(w: PlannedWorkout): boolean {
  return w.type === "weights" || w.type === "low_cadence" || w.intensity === "hard";
}

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
    tsb_very_fatigued: -20,
    weight_sessions: 2,
    weight_sessions_very_fatigued: 1,
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
  it("covers all 7 distinct dates in the week", () => {
    const result = schedule(makeInput());
    const distinctDates = new Set(result.map((w) => w.date));
    expect(distinctDates.size).toBe(7);
    expect(distinctDates.has("2026-04-20")).toBe(true);
    expect(distinctDates.has("2026-04-26")).toBe(true);
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
    const weightDates = result.filter((w) => w.type === "weights").map((w) => w.date);
    expect(weightDates).toHaveLength(2);
    const diffDays =
      (new Date(weightDates[1]).getTime() - new Date(weightDates[0]).getTime()) /
      (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThanOrEqual(2);
  });

  it("does not schedule hard workouts on consecutive dates", () => {
    const result = schedule(makeInput());
    const hardDates = new Set(result.filter((w) => isHardEntry(w)).map((w) => w.date));
    const sorted = [...hardDates].sort();
    for (let i = 1; i < sorted.length; i++) {
      const diff =
        (new Date(sorted[i]).getTime() - new Date(sorted[i - 1]).getTime()) / (1000 * 60 * 60 * 24);
      if (diff === 1) {
        throw new Error(`Back-to-back hard dates: ${sorted[i - 1]} and ${sorted[i]}`);
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

  it("returns an empty plan when every day is already locked", () => {
    const existing: IntervalsEvent[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date("2026-04-20T00:00:00");
      d.setDate(d.getDate() + i);
      existing.push({
        id: i + 1,
        start_date_local: d.toISOString().slice(0, 10),
        name: "Existing",
        category: "WORKOUT",
        type: "Ride",
      });
    }
    const result = schedule(makeInput({ existingEvents: existing }));
    expect(result).toHaveLength(0);
  });

  it("uses moderate intensity cycling when TSB is between thresholds", () => {
    const result = schedule(
      makeInput({
        trainingLoad: { ctl: 50, atl: 52, tsb: 0 },
      }),
    );
    const cycling = result.filter((w) => w.type === "cycling");
    expect(cycling.length).toBeGreaterThan(0);
    // Moderate TSB allows moderate or easy (easy only when needed to avoid
    // back-to-back hard). "hard" would violate the classification.
    for (const ride of cycling) {
      expect(["moderate", "easy"]).toContain(ride.intensity);
    }
  });

  it("treats TSB exactly at tsb_fresh as moderate, not hard", () => {
    const result = schedule(
      makeInput({
        // tsb_fresh is 5; classifyIntensity uses strict `>`, so 5 is moderate.
        trainingLoad: { ctl: 50, atl: 45, tsb: 5 },
      }),
    );
    const cycling = result.filter((w) => w.type === "cycling");
    expect(cycling.length).toBeGreaterThan(0);
    for (const ride of cycling) {
      expect(["moderate", "easy"]).toContain(ride.intensity);
    }
  });

  it("treats TSB exactly at tsb_fatigued as moderate, not easy-forced", () => {
    const result = schedule(
      makeInput({
        trainingLoad: { ctl: 50, atl: 60, tsb: -10 },
      }),
    );
    const cycling = result.filter((w) => w.type === "cycling");
    // Exact boundary is moderate — at least one moderate ride should exist
    // unless every cycling slot was downgraded to easy for back-to-back reasons.
    const moderateCount = cycling.filter((w) => w.intensity === "moderate").length;
    expect(moderateCount).toBeGreaterThan(0);
  });

  it("degrades gracefully when most days are locked", () => {
    // Only dates[1] and dates[3] open; algorithm must not crash and must
    // return only what fits (no duplicate placements, no events on locked dates).
    const existing: IntervalsEvent[] = [
      "2026-04-20",
      "2026-04-22",
      "2026-04-24",
      "2026-04-25",
      "2026-04-26",
    ].map((d, i) => ({
      id: i + 1,
      start_date_local: d,
      name: "Existing",
      category: "WORKOUT",
      type: "Ride",
    }));

    const result = schedule(makeInput({ existingEvents: existing }));

    const distinctDates = new Set(result.map((w) => w.date));
    expect(distinctDates.size).toBeLessThanOrEqual(2);
    for (const w of result) {
      expect(["2026-04-21", "2026-04-23"]).toContain(w.date);
    }
  });

  describe("weights co-location (polarized stacking)", () => {
    const freshLoad = { ctl: 50, atl: 40, tsb: 10 };

    it("co-locates at least one weights session with the low-cadence day", () => {
      const result = schedule(makeInput());
      const lcDate = result.find((w) => w.type === "low_cadence")?.date;
      const weightDates = new Set(result.filter((w) => w.type === "weights").map((w) => w.date));
      expect(lcDate).toBeDefined();
      expect(weightDates.has(lcDate!)).toBe(true);
    });

    it("places cycling before weights on the same date", () => {
      const result = schedule(makeInput({ trainingLoad: freshLoad }));
      // Find a date with both cycling (any intensity) and weights
      const byDate = new Map<string, PlannedWorkout[]>();
      for (const w of result) {
        const arr = byDate.get(w.date) ?? [];
        arr.push(w);
        byDate.set(w.date, arr);
      }
      let checked = 0;
      for (const [, entries] of byDate) {
        const cyclingTypes = new Set(["cycling", "low_cadence"]);
        const hasCycling = entries.some((w) => cyclingTypes.has(w.type));
        const hasWeights = entries.some((w) => w.type === "weights");
        if (hasCycling && hasWeights) {
          const cyclingIdx = entries.findIndex((w) => cyclingTypes.has(w.type));
          const weightsIdx = entries.findIndex((w) => w.type === "weights");
          expect(cyclingIdx).toBeLessThan(weightsIdx);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(0);
    });

    it("when fresh, both weights sessions land on hard-training days", () => {
      const result = schedule(makeInput({ trainingLoad: freshLoad }));
      const weightDates = result.filter((w) => w.type === "weights").map((w) => w.date);
      expect(weightDates).toHaveLength(2);
      for (const d of weightDates) {
        const sameDay = result.filter((w) => w.date === d);
        const hasHardPartner = sameDay.some((w) => w.type !== "weights" && isHardEntry(w));
        expect(hasHardPartner).toBe(true);
      }
    });
  });

  describe("very fatigued (TSB below tsb_very_fatigued)", () => {
    const veryFatiguedLoad = { ctl: 56, atl: 86, tsb: -30 };

    it("drops the low-cadence session entirely", () => {
      const result = schedule(makeInput({ trainingLoad: veryFatiguedLoad }));
      expect(result.filter((w) => w.type === "low_cadence")).toHaveLength(0);
    });

    it("reduces weight sessions to weight_sessions_very_fatigued", () => {
      const result = schedule(makeInput({ trainingLoad: veryFatiguedLoad }));
      expect(result.filter((w) => w.type === "weights")).toHaveLength(1);
    });

    it("keeps all cycling at easy intensity", () => {
      const result = schedule(makeInput({ trainingLoad: veryFatiguedLoad }));
      const cycling = result.filter((w) => w.type === "cycling");
      for (const ride of cycling) {
        expect(ride.intensity).toBe("easy");
      }
    });

    it("places rest on day 0 (starts the week with recovery)", () => {
      const result = schedule(makeInput({ trainingLoad: veryFatiguedLoad }));
      const day0 = result.find((w) => w.date === "2026-04-20");
      expect(day0?.type).toBe("rest");
    });

    it("places the weights session mid-week, not on day 0 or 1", () => {
      const result = schedule(makeInput({ trainingLoad: veryFatiguedLoad }));
      const weightsDay = result.find((w) => w.type === "weights")?.date;
      expect(weightsDay).toBeDefined();
      expect(["2026-04-22", "2026-04-23", "2026-04-24"]).toContain(weightsDay!);
    });

    it("adds a second rest day after the weights session", () => {
      const result = schedule(makeInput({ trainingLoad: veryFatiguedLoad }));
      const rests = result.filter((w) => w.type === "rest");
      expect(rests.length).toBeGreaterThanOrEqual(2);
      const weightsIdx = result.findIndex((w) => w.type === "weights");
      expect(weightsIdx).toBeGreaterThan(0);
      expect(result[weightsIdx + 1]?.type).toBe("rest");
    });

    it("skips the priority day-0 rest if day 0 is already locked", () => {
      const existing: IntervalsEvent[] = [
        {
          id: 1,
          start_date_local: "2026-04-20",
          name: "Locked Ride",
          category: "WORKOUT",
          type: "Ride",
        },
      ];
      const result = schedule(
        makeInput({ trainingLoad: veryFatiguedLoad, existingEvents: existing }),
      );
      expect(result.find((w) => w.date === "2026-04-20")).toBeUndefined();
      expect(result.filter((w) => w.type === "weights")).toHaveLength(1);
    });
  });

  describe("classifyFatigue", () => {
    const cfg = BASE_CONFIG;
    it("returns very_fatigued below tsb_very_fatigued", () => {
      expect(classifyFatigue(-25, cfg)).toBe("very_fatigued");
    });
    it("returns fatigued between tsb_very_fatigued and tsb_fatigued", () => {
      expect(classifyFatigue(-15, cfg)).toBe("fatigued");
    });
    it("returns moderate between tsb_fatigued and tsb_fresh", () => {
      expect(classifyFatigue(0, cfg)).toBe("moderate");
    });
    it("returns fresh above tsb_fresh", () => {
      expect(classifyFatigue(10, cfg)).toBe("fresh");
    });
  });

  it("uses wotd_name for hard rides when provided", () => {
    const result = schedule(
      makeInput({
        trainingLoad: { ctl: 50, atl: 40, tsb: 10 },
        xertInfo: {
          ftp: 250,
          ltp: 210,
          hie: 22,
          pp: 1100,
          training_status: "Fresh",
          focus: "Endurance",
          wotd_name: "SMART Workout 42",
          wotd_description: "4x4min VO2max",
        },
      }),
    );
    const hardRides = result.filter((w) => w.type === "cycling" && w.intensity === "hard");
    expect(hardRides.length).toBeGreaterThan(0);
    for (const ride of hardRides) {
      expect(ride.name).toBe("SMART Workout 42");
      expect(ride.description).toContain("SMART Workout 42");
      expect(ride.description).toContain("4x4min VO2max");
    }
  });
});
