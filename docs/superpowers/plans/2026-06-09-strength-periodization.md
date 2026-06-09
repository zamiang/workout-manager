# Strength Periodization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the weekly planner vary strength session count and routine by training phase (heavy `block` → frequency `taper`), derived from weeks-to-race off the Intervals.icu `RACE_A` event.

**Architecture:** Two new pure functions in `scheduler.ts` (`classifyPhase`, `phaseWeightSessions`) decide phase and session count from a new `weeksToRace` input. The CLI resolves the race date (wide-window `getEvents`, with a `config.periodization.race_date` fallback) and computes `weeksToRace`. The scheduler selects the routine `WorkoutDefinition` (`weight_training` for block, `weight_training_taper` for taper) and stamps its duration onto the weights workout so `attachLoadTargets` uses the right value. Config gains an optional taper routine, a `periodization` block, and `weight_sessions_taper`, all defaulted for backward compatibility.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Vitest, `yaml` parser.

---

## File Structure

- `src/types.ts` — add `weight_training_taper?`, `PeriodizationConfig`, `weight_sessions_taper`, and `weeksToRace?` on `SchedulerInput`.
- `src/config.ts` — defaults + validation for the taper routine and periodization block.
- `src/scheduler.ts` — `Phase` type, `classifyPhase`, `phaseWeightSessions`, routine/count wiring, `attachLoadTargets` duration fix.
- `src/cli.ts` — `resolveRaceDate`, `weeksUntil`, wide-window race fetch, pass `weeksToRace` to `schedule`.
- `config.yaml` — add `weight_training_taper`, `periodization`, `scheduling.weight_sessions_taper`.
- Tests: `test/config.test.ts`, `test/scheduler.test.ts`, `test/cli.test.ts`.

Run the full suite at any time with `npm test`.

---

## Task 1: Config types for periodization + taper routine

**Files:**
- Modify: `src/types.ts` (SchedulingConfig, new PeriodizationConfig, Config)

- [ ] **Step 1: Add `weight_sessions_taper` to `SchedulingConfig`**

In `src/types.ts`, inside `interface SchedulingConfig`, add after the `weight_sessions_very_fatigued` line:

```typescript
  weight_sessions_taper: number; // default 1 — weight sessions/week during the race taper
```

- [ ] **Step 2: Add `PeriodizationConfig` and extend `Config`**

In `src/types.ts`, add a new interface just above `export interface Config {` and extend `Config`:

```typescript
export interface PeriodizationConfig {
  taper_weeks: number; // default 4 — fewer weeks-to-race than this → taper phase
  taper_zero_weeks: number; // default 1 — fewer weeks-to-race than this → no strength
  race_date: string | null; // default null — ISO date fallback when no RACE_A event exists
}

export interface Config {
  weight_training: WorkoutDefinition;
  weight_training_taper?: WorkoutDefinition; // optional; falls back to weight_training
  sweet_spot: WorkoutDefinition;
  scheduling: SchedulingConfig;
  load_targets: LoadTargetsConfig;
  periodization: PeriodizationConfig;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `src/config.ts` (missing `periodization`/`weight_sessions_taper`) and `test/scheduler.test.ts` (BASE_CONFIG missing fields). These are fixed in Tasks 2–3. No errors in `src/types.ts` itself.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add periodization config and taper routine fields"
```

---

## Task 2: Config defaults + validation

**Files:**
- Modify: `src/config.ts`
- Test: `test/config.test.ts`

- [ ] **Step 1: Write failing tests**

In `test/config.test.ts`, add these two tests inside the top-level `describe` block (after the existing valid-config test). They use the existing `VALID_YAML`, `tmpDir`, `fs`, and `path` already in that file. The second test appends `weight_sessions_taper` to `VALID_YAML`'s EXISTING `scheduling:` block via `.replace` — YAML forbids a duplicate top-level `scheduling:` key, so do NOT add a second one.

```typescript
it("defaults periodization and weight_sessions_taper when absent", async () => {
  const file = path.join(tmpDir, "config.yaml");
  await fs.writeFile(file, VALID_YAML);
  const config = await loadConfig(file);
  expect(config.periodization).toEqual({
    taper_weeks: 4,
    taper_zero_weeks: 1,
    race_date: null,
  });
  expect(config.scheduling.weight_sessions_taper).toBe(1);
  expect(config.weight_training_taper).toBeUndefined();
});

it("loads an optional taper routine and periodization overrides", async () => {
  const file = path.join(tmpDir, "config.yaml");
  const yamlWithTaper =
    VALID_YAML.replace("scheduling:", "scheduling:\n  weight_sessions_taper: 1") +
    `
weight_training_taper:
  name: "Taper Lift"
  duration_minutes: 30
  description: "Squat + deadlift, 2 sets"
periodization:
  taper_weeks: 3
  taper_zero_weeks: 2
  race_date: "2026-09-26"
`;
  await fs.writeFile(file, yamlWithTaper);
  const config = await loadConfig(file);
  expect(config.weight_training_taper).toEqual({
    name: "Taper Lift",
    duration_minutes: 30,
    description: "Squat + deadlift, 2 sets",
  });
  expect(config.periodization.taper_weeks).toBe(3);
  expect(config.periodization.taper_zero_weeks).toBe(2);
  expect(config.periodization.race_date).toBe("2026-09-26");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — `config.periodization` is undefined and `weight_sessions_taper` is undefined.

- [ ] **Step 3: Implement defaults + validation in `src/config.ts`**

Add `PeriodizationConfig` to the type import on line 3:

```typescript
import type { Config, LoadTargetsConfig, PeriodizationConfig, SchedulingConfig, WorkoutDefinition } from "./types.js";
```

Add `weight_sessions_taper: 1,` to `SCHEDULING_DEFAULTS` (after `weight_sessions_very_fatigued`). Add `"weight_sessions_taper",` to the `numericFields` array in `validateScheduling`.

Add a periodization default constant after `LOAD_TARGETS_DEFAULTS`:

```typescript
const PERIODIZATION_DEFAULTS: PeriodizationConfig = {
  taper_weeks: 4,
  taper_zero_weeks: 1,
  race_date: null,
};
```

Add a validator after `validateLoadTargets`:

```typescript
function validatePeriodization(raw: unknown): Partial<PeriodizationConfig> {
  if (raw == null) return {};
  if (typeof raw !== "object") {
    throw new Error("periodization must be an object");
  }
  const obj = raw as Record<string, unknown>;
  const out: Partial<PeriodizationConfig> = {};
  for (const field of ["taper_weeks", "taper_zero_weeks"] as const) {
    if (obj[field] === undefined) continue;
    if (typeof obj[field] !== "number") {
      throw new Error(`periodization.${field} must be a number`);
    }
    out[field] = obj[field] as number;
  }
  if (obj.race_date !== undefined) {
    if (obj.race_date !== null && typeof obj.race_date !== "string") {
      throw new Error("periodization.race_date must be a string or null");
    }
    out.race_date = obj.race_date as string | null;
  }
  return out;
}
```

Add an optional-workout helper (returns `undefined` when the key is absent) after `validateWorkout`:

```typescript
function validateOptionalWorkout(raw: unknown, field: string): WorkoutDefinition | undefined {
  if (raw == null) return undefined;
  return validateWorkout(raw, field);
}
```

In `loadConfig`, after the `sweet_spot` line, add:

```typescript
  const weight_training_taper = validateOptionalWorkout(
    doc.weight_training_taper,
    "weight_training_taper",
  );
```

Add the periodization assembly before the `return`:

```typescript
  const periodization: PeriodizationConfig = {
    ...PERIODIZATION_DEFAULTS,
    ...validatePeriodization(doc.periodization),
  };
```

Change the return to include both new fields:

```typescript
  return { weight_training, weight_training_taper, sweet_spot, scheduling, load_targets, periodization };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/config.test.ts`
Expected: PASS (all config tests, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat(config): validate periodization block and optional taper routine"
```

---

## Task 3: Phase classification + session-count helpers

**Files:**
- Modify: `src/scheduler.ts`
- Test: `test/scheduler.test.ts`

- [ ] **Step 1: Add `periodization` to the test BASE_CONFIG**

In `test/scheduler.test.ts`, the `BASE_CONFIG` object is missing the new required `periodization` field and `weight_sessions_taper`. Add `weight_sessions_taper: 1,` inside its `scheduling` block, and add this field to `BASE_CONFIG` (after `load_targets`):

```typescript
  periodization: {
    taper_weeks: 4,
    taper_zero_weeks: 1,
    race_date: null,
  },
```

- [ ] **Step 2: Write failing tests for the pure functions**

In `test/scheduler.test.ts`, update the import to include the new functions:

```typescript
import { schedule, classifyFatigue, rampGuardTriggered, classifyPhase, phaseWeightSessions } from "../src/scheduler.js";
```

Add a new describe block:

```typescript
describe("classifyPhase / phaseWeightSessions", () => {
  it("returns undefined when weeksToRace is undefined", () => {
    expect(classifyPhase(undefined, BASE_CONFIG)).toBeUndefined();
    expect(phaseWeightSessions(undefined, undefined, BASE_CONFIG)).toBe(2);
  });

  it("classifies block at or beyond taper_weeks", () => {
    expect(classifyPhase(4, BASE_CONFIG)).toBe("block");
    expect(classifyPhase(12, BASE_CONFIG)).toBe("block");
    expect(phaseWeightSessions("block", 12, BASE_CONFIG)).toBe(2);
  });

  it("classifies taper below taper_weeks", () => {
    expect(classifyPhase(3, BASE_CONFIG)).toBe("taper");
    expect(phaseWeightSessions("taper", 3, BASE_CONFIG)).toBe(1);
  });

  it("returns zero sessions in the final taper week", () => {
    expect(classifyPhase(0, BASE_CONFIG)).toBe("taper");
    expect(phaseWeightSessions("taper", 0, BASE_CONFIG)).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/scheduler.test.ts`
Expected: FAIL — `classifyPhase`/`phaseWeightSessions` are not exported.

- [ ] **Step 4: Implement the pure functions in `src/scheduler.ts`**

Add after the `classifyFatigue` function (around line 24):

```typescript
export type Phase = "block" | "taper";

// Phase from weeks-to-race. `taper` once fewer than taper_weeks remain; `block`
// (the heavy 12-14 week strength block) otherwise. Undefined when no race is
// known, so the planner keeps its default (non-periodized) behavior.
export function classifyPhase(
  weeksToRace: number | undefined,
  config: Config,
): Phase | undefined {
  if (weeksToRace === undefined) return undefined;
  if (weeksToRace < config.periodization.taper_weeks) return "taper";
  return "block";
}

// Strength sessions/week the phase asks for (before the fatigue cap is applied).
// The final taper week (< taper_zero_weeks) drops strength entirely.
export function phaseWeightSessions(
  phase: Phase | undefined,
  weeksToRace: number | undefined,
  config: Config,
): number {
  if (phase === "taper") {
    if (weeksToRace !== undefined && weeksToRace < config.periodization.taper_zero_weeks) {
      return 0;
    }
    return config.scheduling.weight_sessions_taper;
  }
  return config.scheduling.weight_sessions;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/scheduler.test.ts`
Expected: PASS (new describe block passes; existing scheduler tests still pass).

- [ ] **Step 6: Commit**

```bash
git add src/scheduler.ts test/scheduler.test.ts
git commit -m "feat(scheduler): add classifyPhase and phaseWeightSessions"
```

---

## Task 4: Wire phase into schedule() — routine, count, duration

**Files:**
- Modify: `src/types.ts` (SchedulerInput), `src/scheduler.ts`
- Test: `test/scheduler.test.ts`

- [ ] **Step 1: Add `weeksToRace` to `SchedulerInput`**

In `src/types.ts`, inside `interface SchedulerInput`, add after `completedDates`:

```typescript
  weeksToRace?: number; // whole weeks until the A race; undefined when no race is known
```

- [ ] **Step 2: Write failing tests for scheduling behavior**

In `test/scheduler.test.ts`, add a describe block. `makeInput` already builds a fresh-TSB input (TSB high → fatigue `fresh`); pass `weeksToRace` and a taper routine via config override:

```typescript
describe("periodized strength scheduling", () => {
  const taperConfig: Config = {
    ...BASE_CONFIG,
    weight_training_taper: {
      name: "Taper Lift",
      duration_minutes: 30,
      description: "Squat + deadlift, low volume",
    },
  };

  it("uses the block routine and full session count when far from the race", () => {
    const plan = schedule(makeInput({ config: taperConfig, weeksToRace: 12 }));
    const weights = plan.filter((w) => w.type === "weights");
    expect(weights.length).toBe(2);
    expect(weights.every((w) => w.name === "Strength")).toBe(true);
    expect(weights.every((w) => w.durationMin === 60)).toBe(true);
  });

  it("uses the taper routine and one session inside the taper window", () => {
    const plan = schedule(makeInput({ config: taperConfig, weeksToRace: 3 }));
    const weights = plan.filter((w) => w.type === "weights");
    expect(weights.length).toBe(1);
    expect(weights[0].name).toBe("Taper Lift");
    expect(weights[0].durationMin).toBe(30);
  });

  it("places no strength in the final taper week", () => {
    const plan = schedule(makeInput({ config: taperConfig, weeksToRace: 0 }));
    expect(plan.filter((w) => w.type === "weights").length).toBe(0);
  });

  it("falls back to the block routine when no taper variant is defined", () => {
    const plan = schedule(makeInput({ config: BASE_CONFIG, weeksToRace: 3 }));
    const weights = plan.filter((w) => w.type === "weights");
    expect(weights.length).toBe(1);
    expect(weights[0].name).toBe("Strength");
    expect(weights[0].durationMin).toBe(60);
  });

  it("is unchanged when weeksToRace is undefined (backward compat)", () => {
    const plan = schedule(makeInput({ config: BASE_CONFIG }));
    expect(plan.filter((w) => w.type === "weights").length).toBe(2);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/scheduler.test.ts`
Expected: FAIL — taper tests get the block routine/count (phase not wired yet).

- [ ] **Step 4: Wire phase selection into `schedule()`**

In `src/scheduler.ts`, destructure `weeksToRace` from `input` (add to the existing destructure around line 73-82):

```typescript
    completedDates,
    weeksToRace,
```

Replace the `weightSessionsTarget` block (currently lines ~121-123) with phase-aware selection:

```typescript
  const phase = classifyPhase(weeksToRace, config);
  const strengthRoutine =
    phase === "taper" ? (weight_training_taper ?? weight_training) : weight_training;
  // Phase asks for a session count; fatigue can only reduce it, never inflate it.
  const fatigueSessions = veryFatigued
    ? scheduling.weight_sessions_very_fatigued
    : scheduling.weight_sessions;
  const weightSessionsTarget = Math.min(
    phaseWeightSessions(phase, weeksToRace, config),
    fatigueSessions,
  );
```

Add `weight_training_taper` to the config destructure on line 84:

```typescript
  const { scheduling, weight_training, weight_training_taper, sweet_spot } = config;
```

In the weights placement loop (currently lines ~227-235), use the selected routine and stamp its duration:

```typescript
  for (const i of weightSlots) {
    plan[i].push({
      date: dates[i],
      type: "weights",
      name: strengthRoutine.name,
      description: strengthRoutine.description,
      intensity: "hard",
      durationMin: strengthRoutine.duration_minutes,
    });
  }
```

- [ ] **Step 5: Fix `attachLoadTargets` to respect the stamped duration**

In `attachLoadTargets`, change the weights branch (currently `w.durationMin = config.weight_training.duration_minutes;`) to keep an already-set value:

```typescript
    if (w.type === "weights") {
      w.durationMin = w.durationMin ?? config.weight_training.duration_minutes;
      continue;
    }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/scheduler.test.ts`
Expected: PASS (all scheduler tests).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/scheduler.ts test/scheduler.test.ts
git commit -m "feat(scheduler): select strength routine and session count by race phase"
```

---

## Task 5: Resolve race date + weeks-to-race in the CLI

**Files:**
- Modify: `src/cli.ts`
- Test: `test/cli.test.ts`

- [ ] **Step 1: Write failing tests for the helpers**

In `test/cli.test.ts`, add an import for the new helpers (merge with the existing `../src/cli.js` import):

```typescript
import { resolveRaceDate, weeksUntil } from "../src/cli.js";
```

Add tests:

```typescript
describe("resolveRaceDate", () => {
  const ev = (date: string, category: string): IntervalsEvent => ({
    start_date_local: date,
    name: "x",
    category,
  });

  it("returns the earliest future RACE_A event date", () => {
    const events = [ev("2026-10-10T07:00:00", "RACE_A"), ev("2026-09-26T07:00:00", "RACE_A")];
    expect(resolveRaceDate(events, "2026-06-09", null)).toBe("2026-09-26");
  });

  it("ignores past races and non-race events", () => {
    const events = [ev("2026-01-01T07:00:00", "RACE_A"), ev("2026-09-26T07:00:00", "WORKOUT")];
    expect(resolveRaceDate(events, "2026-06-09", null)).toBeUndefined();
  });

  it("falls back to config race_date when no RACE_A is present", () => {
    expect(resolveRaceDate([], "2026-06-09", "2026-09-26")).toBe("2026-09-26");
  });

  it("ignores a past fallback race_date", () => {
    expect(resolveRaceDate([], "2026-06-09", "2026-01-01")).toBeUndefined();
  });
});

describe("weeksUntil", () => {
  it("rounds up partial weeks", () => {
    expect(weeksUntil("2026-06-09", "2026-06-09")).toBe(0);
    expect(weeksUntil("2026-06-09", "2026-06-10")).toBe(1);
    expect(weeksUntil("2026-06-09", "2026-09-26")).toBe(16);
  });
});
```

If `IntervalsEvent` is not already imported in `test/cli.test.ts`, add it to the type import from `../src/types.js`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/cli.test.ts`
Expected: FAIL — `resolveRaceDate` / `weeksUntil` are not exported.

- [ ] **Step 3: Implement the helpers in `src/cli.ts`**

Add near `computeWeeklyRampPct` (top of the file, after the imports):

```typescript
// Earliest future A-priority race date (YYYY-MM-DD) from calendar events, else
// the configured race_date fallback, else undefined when no race is known.
export function resolveRaceDate(
  events: IntervalsEvent[],
  today: string,
  raceDateFallback: string | null,
): string | undefined {
  const races = events
    .filter((e) => e.category === "RACE_A")
    .map((e) => e.start_date_local.slice(0, 10))
    .filter((d) => d >= today)
    .sort();
  if (races.length > 0) return races[0];
  if (raceDateFallback && raceDateFallback.slice(0, 10) >= today) {
    return raceDateFallback.slice(0, 10);
  }
  return undefined;
}

// Whole weeks from `today` until `raceDate`, rounded up (a partial week counts).
export function weeksUntil(today: string, raceDate: string): number {
  const dayMs = 24 * 60 * 60 * 1000;
  const diff =
    new Date(raceDate + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime();
  return Math.ceil(diff / (7 * dayMs));
}
```

- [ ] **Step 4: Fetch races and pass `weeksToRace` to `schedule()`**

In the plan command (around line 202), after `const endStr = ...`, add a race-horizon date:

```typescript
  const raceHorizon = new Date();
  raceHorizon.setDate(raceHorizon.getDate() + 364);
  const raceHorizonStr = raceHorizon.toISOString().slice(0, 10);
```

Add a dedicated wide-window fetch to the `Promise.all` array (after the existing `intervals.getEvents(today, endStr)` entry):

```typescript
    intervals.getEvents(today, raceHorizonStr),
```

and add a matching binding to the destructured array (name it `raceEvents`):

```typescript
  const [events, load, info, activities, wellnessRange, raceEvents] = await Promise.all([
```

After `rampRatePct` / `completedDates` are computed, derive `weeksToRace`:

```typescript
  const raceDate = resolveRaceDate(raceEvents, today, config.periodization.race_date);
  const weeksToRace = raceDate ? weeksUntil(today, raceDate) : undefined;
```

Pass it into the `schedule({ ... })` call:

```typescript
    completedDates,
    weeksToRace,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/cli.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts test/cli.test.ts
git commit -m "feat(cli): resolve race date and pass weeks-to-race into the scheduler"
```

---

## Task 6: Author the taper routine + periodization in config.yaml

**Files:**
- Modify: `config.yaml`

- [ ] **Step 1: Add the taper routine after the `weight_training` block**

In `config.yaml`, after the `weight_training:` block (just before `sweet_spot:`), add:

```yaml
weight_training_taper:
  name: "Strength Taper"
  duration_minutes: 30
  description: |
    Race-approach maintenance — keep the heavy stimulus, cut the fatigue.
    Frequency drops to 1x/week; this is NOT a deload of load, only of volume.

    Warm-Up (6 min)
    Deadbugs (2x10), band pull-aparts, bodyweight squats, then 2 light ramp-up
    sets on the squat.

    Heavy Compounds (20 min) — same load as your block, far less volume.
    1. Goblet or Barbell Back Squat — 2x4-5 @ heavy
       Keep the load you built. Crisp, fast reps; stop well short of failure.
    2. Romanian / Trap-Bar Deadlift — 2x4-5 @ heavy
       Heavy hinge, low volume. Leave the gym feeling fresh, not cooked.

    Cooldown (4 min)
    Hip flexor stretch, pigeon pose. Skip accessories — the goal is to retain
    strength while staying race-fresh.

    Note: drop strength entirely in the final race week.
```

- [ ] **Step 2: Add the periodization block and taper session count**

In `config.yaml`, add a top-level `periodization:` block (place it just above `scheduling:`):

```yaml
periodization:
  taper_weeks: 4 # fewer weeks-to-race than this → taper routine, 1x/week
  taper_zero_weeks: 1 # final week before the race → no strength
  race_date: null # fallback only; the RACE_A calendar event is used when present
```

Add `weight_sessions_taper` to the existing `scheduling:` block:

```yaml
  weight_sessions_taper: 1
```

- [ ] **Step 3: Verify the config loads**

Run: `npx tsx -e "import {loadConfig} from './src/config.ts'; loadConfig('./config.yaml').then(c => console.log('taper:', c.weight_training_taper?.name, '| taper_weeks:', c.periodization.taper_weeks, '| ws_taper:', c.scheduling.weight_sessions_taper));"`
Expected: `taper: Strength Taper | taper_weeks: 4 | ws_taper: 1`

- [ ] **Step 4: Commit**

```bash
git add config.yaml
git commit -m "feat(config): add strength taper routine and periodization settings"
```

---

## Task 7: End-to-end dry run

**Files:** none (verification only)

- [ ] **Step 1: Run the planner dry-run**

Run: `npm run plan -- --dry-run`
Expected: prints a week plan without errors. With the race (Escape New York, 2026-09-26) ~15 weeks out, the strength sessions should use the **block** routine ("Cyclist Strength Routine") at 2×/week — confirming phase wiring end-to-end against live data.

- [ ] **Step 2: Final full suite + typecheck**

Run: `npx tsc --noEmit && npm test`
Expected: clean.

- [ ] **Step 3: Push the branch**

```bash
git push
```

Expected: updates PR #15 with the implementation commits.

---

## Notes for the implementer

- This repo uses ESM with `.js` suffixes in imports even for `.ts` files — keep that convention.
- `makeInput()` in `test/scheduler.test.ts` defaults to a fresh-TSB input, so phase tests there exercise the `fresh` fatigue path; the `min(phase, fatigue)` cap is covered implicitly (fresh → fatigueSessions = `weight_sessions` = 2, so the phase count wins below 2).
- Do not touch the cycling/sweet-spot/load-target logic — periodization only governs the `weights` workouts.
