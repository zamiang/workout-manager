import type {
  SchedulerInput,
  PlannedWorkout,
  WorkoutType,
  CyclingIntensity,
  Config,
  XertTrainingInfo,
} from "./types.js";
import { mostDeficientZone, zoneLabel, type Zone } from "./zones.js";

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export type FatigueLevel = "fresh" | "moderate" | "fatigued" | "very_fatigued";

export function classifyFatigue(tsb: number, config: Config): FatigueLevel {
  if (tsb < config.scheduling.tsb_very_fatigued) return "very_fatigued";
  if (tsb < config.scheduling.tsb_fatigued) return "fatigued";
  if (tsb > config.scheduling.tsb_fresh) return "fresh";
  return "moderate";
}

function classifyIntensity(fatigue: FatigueLevel): CyclingIntensity {
  if (fatigue === "fresh") return "hard";
  if (fatigue === "fatigued" || fatigue === "very_fatigued") return "easy";
  return "moderate";
}

function isHard(type: WorkoutType, intensity: CyclingIntensity | "hard"): boolean {
  if (type === "weights" || type === "low_cadence") return true;
  return intensity === "hard";
}

function buildCyclingDescription(
  intensity: CyclingIntensity,
  xert: XertTrainingInfo,
  targetZone?: Zone,
): string {
  const zoneSuffix = targetZone ? ` — target zone: ${zoneLabel(targetZone)}` : "";
  switch (intensity) {
    case "easy":
      return "Easy ride — Zone 2 recovery spin";
    case "moderate":
      return `Moderate ride — Xert focus: ${xert.focus}${zoneSuffix}`;
    case "hard":
      return xert.wotd_name
        ? `${xert.wotd_name} — ${xert.wotd_description ?? xert.focus}${zoneSuffix}`
        : `Hard ride — Xert focus: ${xert.focus}${zoneSuffix}`;
  }
}

// Polarized placement: consolidate stress onto "hard days" (low-cadence +
// hard-cycling target days) so weights stack with them in the same session,
// preserving full-recovery days for easy rides or rest. Within a stacked day,
// the cycling workout precedes the weights session — hard intervals are done
// on fresh legs; weights go last so the aerobic AMPK signal has begun to fade.
//
// Fatigue tiers:
//   - fresh:          hard cycling targets + weights co-locate on both
//   - moderate/fatigued: only low-cadence is a natural hard day; weights
//                        stack with it and overflow to their own day(s)
//   - very_fatigued:  day 0 reserved for rest; low-cadence dropped; a single
//                     strength session placed mid-week
export function schedule(input: SchedulerInput): PlannedWorkout[] {
  const { startDate, existingEvents, trainingLoad, xertInfo, config, zoneDistribution } = input;
  const days = 7;
  const { scheduling, weight_training, low_cadence } = config;

  // Track zones already assigned to hard rides this week so consecutive hard
  // days target different zones (highest deficit first, then second-highest).
  const usedHardZones = new Set<Zone>();
  const pickHardZone = (): Zone | undefined => {
    if (!zoneDistribution) return undefined;
    const z = mostDeficientZone(zoneDistribution, undefined, usedHardZones);
    usedHardZones.add(z);
    return z;
  };

  const lockedDates = new Set(existingEvents.map((e) => e.start_date_local));
  const dates: string[] = [];
  for (let i = 0; i < days; i++) dates.push(addDays(startDate, i));
  const available = dates.map((d, i) => (lockedDates.has(d) ? -1 : i)).filter((i) => i >= 0);

  const fatigue = classifyFatigue(trainingLoad.tsb, config);
  const intensity = classifyIntensity(fatigue);
  const veryFatigued = fatigue === "very_fatigued";
  const weightSessionsTarget = veryFatigued
    ? scheduling.weight_sessions_very_fatigued
    : scheduling.weight_sessions;

  // Each day can hold multiple workouts (hard cycling + weights = one stacked
  // training day, two PlannedWorkout entries).
  const plan: PlannedWorkout[][] = Array.from({ length: days }, () => []);
  const isHardDay = (idx: number): boolean => plan[idx].some((w) => isHard(w.type, w.intensity));
  const isEmpty = (idx: number): boolean => plan[idx].length === 0;
  const wouldCreateBackToBack = (idx: number): boolean => {
    if (idx > 0 && isHardDay(idx - 1)) return true;
    if (idx < days - 1 && isHardDay(idx + 1)) return true;
    return false;
  };
  const respectsWeightGap = (idx: number, slots: number[]): boolean =>
    slots.every((s) => Math.abs(idx - s) >= scheduling.min_weight_gap_days);

  // Phase 0: when very fatigued, reserve day 0 as rest before any hard placement.
  if (veryFatigued && available.includes(0)) {
    plan[0].push({
      date: dates[0],
      type: "rest",
      name: "Rest Day",
      description: "Priority recovery — starting the week very fatigued",
      intensity: "easy",
    });
  }

  // Phase 1: low-cadence (mid-week), unless very fatigued.
  let lcIdx: number | undefined;
  if (!veryFatigued) {
    const lcCandidates = available.filter((i) => isEmpty(i) && !wouldCreateBackToBack(i));
    lcIdx = lcCandidates.find((i) => i >= 2 && i <= 4) ?? lcCandidates[0];
    if (lcIdx !== undefined) {
      plan[lcIdx].push({
        date: dates[lcIdx],
        type: "low_cadence",
        name: low_cadence.name,
        description: low_cadence.description,
        intensity: "hard",
      });
    }
  }

  // Phase 2: pre-select hard cycling target days (only when fresh enough).
  // These days will get hard cycling AND become co-location sites for weights.
  // We cap at weightSessionsTarget so every target can host a strength session.
  const hardCyclingTargets = new Set<number>();
  if (intensity === "hard") {
    for (const i of available) {
      if (hardCyclingTargets.size >= weightSessionsTarget) break;
      if (!isEmpty(i)) continue;
      if (wouldCreateBackToBack(i)) continue;
      // Spacing: hard cycling days follow min_weight_gap_days from each other
      // and from the low-cadence day, so co-located weights get proper rest.
      const existingHardSpots = [lcIdx, ...hardCyclingTargets].filter(
        (x): x is number => x !== undefined,
      );
      if (!respectsWeightGap(i, existingHardSpots)) continue;
      hardCyclingTargets.add(i);
      const targetZone = pickHardZone();
      plan[i].push({
        date: dates[i],
        type: "cycling",
        name: xertInfo.wotd_name ?? "Hard Ride",
        description: buildCyclingDescription("hard", xertInfo, targetZone),
        intensity: "hard",
        ...(targetZone ? { targetZone } : {}),
      });
    }
  }

  // Phase 3: place weights, co-locating with hard days first, then overflowing.
  const weightSlots: number[] = [];
  const hardStackOrder = [
    ...(lcIdx !== undefined ? [lcIdx] : []),
    ...[...hardCyclingTargets].sort((a, b) => a - b),
  ].sort((a, b) => a - b);
  for (const i of hardStackOrder) {
    if (weightSlots.length >= weightSessionsTarget) break;
    if (!respectsWeightGap(i, weightSlots)) continue;
    weightSlots.push(i);
  }

  if (weightSlots.length < weightSessionsTarget) {
    // Overflow: find additional days for weights. Candidates are empty days
    // (plus hard-cycling target days that weren't picked above, but those are
    // already "full" from our POV). Very_fatigued prefers mid-week.
    const overflowCandidates = available.filter((i) => isEmpty(i) && !weightSlots.includes(i));
    const ordered = veryFatigued
      ? [...overflowCandidates].sort((a, b) => {
          const midA = a >= 2 && a <= 4 ? 0 : 1;
          const midB = b >= 2 && b <= 4 ? 0 : 1;
          return midA - midB || a - b;
        })
      : overflowCandidates;
    for (const i of ordered) {
      if (weightSlots.length >= weightSessionsTarget) break;
      if (wouldCreateBackToBack(i)) continue;
      if (!respectsWeightGap(i, weightSlots)) continue;
      weightSlots.push(i);
    }
  }

  for (const i of weightSlots) {
    plan[i].push({
      date: dates[i],
      type: "weights",
      name: weight_training.name,
      description: weight_training.description,
      intensity: "hard",
    });
  }

  // Phase 4: rest day — placed after the hardest cluster. Skipped if day 0
  // rest already exists and no natural "after hard" slot is better; in that
  // case we still try to find a second rest for recovery from the weights.
  const restCandidates = available.filter((i) => isEmpty(i));
  const restIdx =
    restCandidates.find((i) => i > 0 && isHardDay(i - 1)) ??
    restCandidates[restCandidates.length - 1];
  if (restIdx !== undefined) {
    plan[restIdx].push({
      date: dates[restIdx],
      type: "rest",
      name: "Rest Day",
      description: "Recovery — no planned workout",
      intensity: "easy",
    });
  }

  // Phase 5: fill remaining empty days with cycling at the default intensity,
  // downgrading to easy if it would create back-to-back hard.
  for (let i = 0; i < days; i++) {
    if (!isEmpty(i) || lockedDates.has(dates[i])) continue;
    let rideIntensity = intensity;
    if (rideIntensity === "hard" && wouldCreateBackToBack(i)) {
      rideIntensity = "easy";
    }
    const targetZone = rideIntensity === "hard" ? pickHardZone() : undefined;
    plan[i].push({
      date: dates[i],
      type: "cycling",
      name:
        rideIntensity === "easy"
          ? "Easy Ride"
          : rideIntensity === "moderate"
            ? "Moderate Ride"
            : (xertInfo.wotd_name ?? "Hard Ride"),
      description: buildCyclingDescription(rideIntensity, xertInfo, targetZone),
      intensity: rideIntensity,
      ...(targetZone ? { targetZone } : {}),
    });
  }

  // Flatten, preserving date order. Within a day, cycling precedes weights:
  // hard intervals go first on fresh legs; weights go after the aerobic
  // AMPK signal has begun to fade.
  const typeRank = (t: WorkoutType): number => {
    if (t === "rest") return 0;
    if (t === "cycling" || t === "low_cadence") return 1;
    return 2; // weights
  };
  const out: PlannedWorkout[] = [];
  for (let i = 0; i < days; i++) {
    const sorted = [...plan[i]].sort((a, b) => typeRank(a.type) - typeRank(b.type));
    out.push(...sorted);
  }
  return out;
}
