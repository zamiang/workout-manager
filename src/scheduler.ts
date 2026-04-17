import type {
  SchedulerInput,
  PlannedWorkout,
  WorkoutType,
  CyclingIntensity,
  IntervalsEvent,
  Config,
  TrainingLoad,
  XertTrainingInfo,
} from "./types.js";

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function classifyIntensity(
  tsb: number,
  config: Config,
): CyclingIntensity {
  if (tsb > config.scheduling.tsb_fresh) return "hard";
  if (tsb < config.scheduling.tsb_fatigued) return "easy";
  return "moderate";
}

function isHard(type: WorkoutType, intensity: CyclingIntensity | "hard"): boolean {
  if (type === "weights" || type === "low_cadence") return true;
  return intensity === "hard";
}

function buildCyclingDescription(
  intensity: CyclingIntensity,
  xert: XertTrainingInfo,
): string {
  switch (intensity) {
    case "easy":
      return "Easy ride — Zone 2 recovery spin";
    case "moderate":
      return `Moderate ride — Xert focus: ${xert.focus}`;
    case "hard":
      return xert.wotd_name
        ? `${xert.wotd_name} — ${xert.wotd_description ?? xert.focus}`
        : `Hard ride — Xert focus: ${xert.focus}`;
  }
}

export function schedule(input: SchedulerInput): PlannedWorkout[] {
  const { startDate, existingEvents, trainingLoad, xertInfo, config } = input;
  const days = 7;
  const { scheduling, weight_training, low_cadence } = config;

  // Build set of dates that already have events
  const lockedDates = new Set(
    existingEvents.map((e) => e.start_date_local),
  );

  // Generate the 7 dates
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    dates.push(addDays(startDate, i));
  }

  // Available day indices (not locked)
  const available = dates
    .map((d, i) => (lockedDates.has(d) ? -1 : i))
    .filter((i) => i >= 0);

  const intensity = classifyIntensity(trainingLoad.tsb, config);

  // Assign workout types to available slots
  const plan: (PlannedWorkout | null)[] = new Array(days).fill(null);

  // Helper: check if assigning a hard workout at index i would create back-to-back hard
  function wouldCreateBackToBack(idx: number, hardType: boolean): boolean {
    if (!hardType) return false;
    if (idx > 0 && plan[idx - 1] && isHard(plan[idx - 1]!.type, plan[idx - 1]!.intensity)) {
      return true;
    }
    if (idx < days - 1 && plan[idx + 1] && isHard(plan[idx + 1]!.type, plan[idx + 1]!.intensity)) {
      return true;
    }
    return false;
  }

  // 1. Place low cadence — pick a day with moderate freshness, avoiding edges if possible
  const lcCandidates = available.filter(
    (i) => !wouldCreateBackToBack(i, true),
  );
  const lcIdx = lcCandidates.find((i) => i >= 2 && i <= 4) ?? lcCandidates[0];
  if (lcIdx !== undefined) {
    plan[lcIdx] = {
      date: dates[lcIdx],
      type: "low_cadence",
      name: low_cadence.name,
      description: low_cadence.description,
      intensity: "hard",
    };
  }

  // 2. Place weight training — 2 sessions, spaced min_weight_gap_days apart
  const weightSlots: number[] = [];
  const remainingAvailable = available.filter(
    (i) => plan[i] === null,
  );

  for (const i of remainingAvailable) {
    if (wouldCreateBackToBack(i, true)) continue;
    if (
      weightSlots.length > 0 &&
      i - weightSlots[weightSlots.length - 1] < scheduling.min_weight_gap_days
    ) {
      continue;
    }
    weightSlots.push(i);
    if (weightSlots.length >= scheduling.weight_sessions) break;
  }

  for (const i of weightSlots) {
    plan[i] = {
      date: dates[i],
      type: "weights",
      name: weight_training.name,
      description: weight_training.description,
      intensity: "hard",
    };
  }

  // 3. Assign rest day — pick the day after the hardest cluster
  const restCandidates = available.filter((i) => plan[i] === null);
  const restIdx = restCandidates.find(
    (i) => i > 0 && plan[i - 1] !== null && isHard(plan[i - 1]!.type, plan[i - 1]!.intensity),
  ) ?? restCandidates[restCandidates.length - 1];

  if (restIdx !== undefined) {
    plan[restIdx] = {
      date: dates[restIdx],
      type: "rest",
      name: "Rest Day",
      description: "Recovery — no planned workout",
      intensity: "easy",
    };
  }

  // 4. Fill remaining with cycling
  for (let i = 0; i < days; i++) {
    if (plan[i] !== null || lockedDates.has(dates[i])) continue;

    let rideIntensity = intensity;
    if (wouldCreateBackToBack(i, rideIntensity === "hard")) {
      rideIntensity = "easy";
    }

    plan[i] = {
      date: dates[i],
      type: "cycling",
      name:
        rideIntensity === "easy"
          ? "Easy Ride"
          : rideIntensity === "moderate"
            ? "Moderate Ride"
            : xertInfo.wotd_name ?? "Hard Ride",
      description: buildCyclingDescription(rideIntensity, xertInfo),
      intensity: rideIntensity,
    };
  }

  // Return only planned workouts (skip locked dates)
  return plan.filter((w): w is PlannedWorkout => w !== null);
}
