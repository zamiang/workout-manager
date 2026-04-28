import { config as loadEnv } from "dotenv";
loadEnv({ quiet: true });
import { loadConfig } from "./config.js";
import { IntervalsClient } from "./intervals.js";
import { XertClient } from "./xert.js";
import { schedule, classifyFatigue } from "./scheduler.js";
import { computeDistribution, zoneLabel } from "./zones.js";
import type { PlannedWorkout, IntervalsEvent, WorkoutType } from "./types.js";

interface ParsedArgs {
  command: "plan" | "status";
  dryRun: boolean;
}

export function parseArgs(args: string[]): ParsedArgs {
  if (args.length === 0) {
    throw new Error("No command provided. Usage: workout-planner <plan|status>");
  }

  const command = args[0];
  if (command !== "plan" && command !== "status") {
    throw new Error(`Unknown command: ${command}. Usage: workout-planner <plan|status>`);
  }

  const dryRun = args.includes("--dry-run");
  return { command, dryRun };
}

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing environment variable: ${name}`);
  return val;
}

export function formatPlan(workouts: PlannedWorkout[]): string {
  const lines = workouts.map((w) => {
    const day = new Date(w.date + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "short",
    });
    const icon =
      w.type === "rest"
        ? "  "
        : w.type === "weights"
          ? "WT"
          : w.type === "low_cadence"
            ? "LC"
            : "CY";
    const zoneTag = w.targetZone ? ` (${zoneLabel(w.targetZone)})` : "";
    return `${w.date} (${day})  [${icon}]  ${w.name}  — ${w.intensity}${zoneTag}`;
  });
  return lines.join("\n");
}

// Keyed by WorkoutType so adding a new variant is a compile error until the
// mapping is updated.
const WORKOUT_TYPE_TO_EVENT_TYPE: Record<WorkoutType, string> = {
  cycling: "Ride",
  low_cadence: "Ride",
  weights: "WeightTraining",
  rest: "Note",
};

export function workoutToEvent(w: PlannedWorkout): IntervalsEvent {
  return {
    start_date_local: w.date,
    name: w.name,
    category: w.type === "rest" ? "NOTE" : "WORKOUT",
    type: WORKOUT_TYPE_TO_EVENT_TYPE[w.type],
    description: w.description,
  };
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const { command, dryRun } = parseArgs(rawArgs);

  const intervalsKey = requireEnv("INTERVALS_API_KEY");
  const xertUser = requireEnv("XERT_USERNAME");
  const xertPass = requireEnv("XERT_PASSWORD");

  const intervals = new IntervalsClient(intervalsKey);
  const xert = new XertClient(xertUser, xertPass);

  const config = await loadConfig("config.yaml");

  if (command === "status") {
    await xert.authenticate();
    const today = new Date().toISOString().slice(0, 10);
    const [load, info] = await Promise.all([
      intervals.getTrainingLoad(today),
      xert.getTrainingInfo(),
    ]);

    console.log("=== Training Status ===");
    console.log(`CTL (Fitness):  ${load.ctl}`);
    console.log(`ATL (Fatigue):  ${load.atl}`);
    console.log(`TSB (Form):     ${load.tsb}`);
    console.log();
    console.log(`FTP:    ${info.ftp}W`);
    console.log(`LTP:    ${info.ltp}W`);
    console.log(`HIE:    ${info.hie} kJ`);
    console.log(`PP:     ${info.pp}W`);
    console.log(`Status: ${info.training_status}`);
    console.log(`Focus:  ${info.focus}`);
    return;
  }

  // plan command
  await xert.authenticate();
  const today = new Date().toISOString().slice(0, 10);
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 6);
  const endStr = endDate.toISOString().slice(0, 10);
  const lookbackStart = new Date();
  lookbackStart.setDate(lookbackStart.getDate() - 28);
  const lookbackStr = lookbackStart.toISOString().slice(0, 10);

  const [events, load, info, activities] = await Promise.all([
    intervals.getEvents(today, endStr),
    intervals.getTrainingLoad(today),
    xert.getTrainingInfo(),
    intervals.getActivities(lookbackStr, today),
  ]);

  const zoneDistribution = computeDistribution(activities);

  const planned = schedule({
    startDate: today,
    existingEvents: events,
    trainingLoad: load,
    xertInfo: info,
    config,
    zoneDistribution,
  });

  const fatigue = classifyFatigue(load.tsb, config);
  const fatigueLabel: Record<string, string> = {
    fresh: "fresh — scheduling hard rides",
    moderate: "moderate — mixed intensity",
    fatigued: "fatigued — cycling kept easy",
    very_fatigued: "very fatigued — dropped low-cadence, reduced weights",
  };

  console.log("=== Weekly Plan ===");
  console.log(
    `TSB ${load.tsb.toFixed(1)} (${fatigueLabel[fatigue] ?? fatigue}) — Xert: ${info.training_status || "n/a"}`,
  );
  console.log();
  console.log(formatPlan(planned));
  console.log();

  if (dryRun) {
    console.log("(dry run — nothing pushed to Intervals.icu)");
    return;
  }

  console.log("Pushing to Intervals.icu...");
  for (const w of planned) {
    if (w.type === "rest") continue; // don't push rest days
    const event = workoutToEvent(w);
    await intervals.createEvent(event);
    console.log(`  Created: ${w.date} — ${w.name}`);
  }
  console.log("Done.");
}

// Only run main when executed directly (not when imported by tests)
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] != null &&
  (process.argv[1].endsWith("/cli.js") || process.argv[1].endsWith("/cli.ts"));

if (isMain) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
