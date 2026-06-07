// Push an editable, hand-tuned week to the Intervals.icu calendar.
//
//   npm run push-week -- --dry-run                 # preview, write nothing
//   npm run push-week                              # push scripts/week-plan.yaml
//   npm run push-week -- --start 2026-06-08        # anchor to a specific Monday
//   npm run push-week -- --file other-plan.yaml    # use a different plan file
//
// Use this when the generated `npm run plan` isn't quite what you want and you
// want to schedule a specific week by hand. The plan file format is documented
// in scripts/week-plan.yaml. Days that already have a calendar event are
// skipped, so re-running is safe and never duplicates.
import { config as loadEnv } from "dotenv";
loadEnv({ quiet: true });
import { promises as fs } from "node:fs";
import { parse } from "yaml";
import { loadConfig } from "../src/config.js";
import { IntervalsClient } from "../src/intervals.js";
import type { Config, IntervalsEvent } from "../src/types.js";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface PlanSession {
  day: string | number;
  workout?: "low_cadence" | "weight_training";
  name?: string;
  type?: string;
  description?: string;
}

function parseFlag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// The Monday on or after the given date (or today). Anchoring to a Monday keeps
// `day: Tue` etc. unambiguous regardless of when the script is run.
function upcomingMonday(from = new Date()): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  if (dow !== 0) d.setDate(d.getDate() + (7 - dow));
  return d;
}

function offsetForDay(day: string | number): number {
  if (typeof day === "number") return day;
  const idx = WEEKDAYS.indexOf(day);
  if (idx < 0) throw new Error(`Unknown day "${day}" — use ${WEEKDAYS.join("/")} or a 0-6 offset`);
  return idx;
}

function dateStr(anchor: Date, offset: number): string {
  const d = new Date(anchor);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function sessionToEvent(s: PlanSession, date: string, config: Config): IntervalsEvent {
  if (s.workout) {
    const def = config[s.workout];
    return {
      start_date_local: `${date}T00:00:00`,
      name: def.name,
      category: "WORKOUT",
      type: s.workout === "weight_training" ? "WeightTraining" : "Ride",
      description: def.description,
    };
  }
  if (!s.name || !s.type) {
    throw new Error(`Session on ${date} needs either a 'workout' or both 'name' and 'type'`);
  }
  return {
    start_date_local: `${date}T00:00:00`,
    name: s.name,
    category: "WORKOUT",
    type: s.type,
    description: (s.description ?? "").trim(),
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const file = parseFlag("file") ?? "scripts/week-plan.yaml";
  const startArg = parseFlag("start");
  const anchor = startArg ? upcomingMonday(new Date(`${startArg}T00:00:00`)) : upcomingMonday();

  const config = await loadConfig("config.yaml");
  const doc = parse(await fs.readFile(file, "utf8")) as { sessions?: PlanSession[] };
  const sessions = doc?.sessions ?? [];
  if (sessions.length === 0) throw new Error(`No sessions found in ${file}`);

  const events = sessions
    .map((s) => sessionToEvent(s, dateStr(anchor, offsetForDay(s.day)), config))
    .sort((a, b) => a.start_date_local.localeCompare(b.start_date_local));

  const oldest = events[0].start_date_local.slice(0, 10);
  const newest = events[events.length - 1].start_date_local.slice(0, 10);
  const anchorStr = dateStr(anchor, 0);

  const client = new IntervalsClient(process.env.INTERVALS_API_KEY!);
  const existing = await client.getEvents(oldest, newest);
  const taken = new Set(existing.map((e) => e.start_date_local.slice(0, 10)));

  console.log(`Week anchored to Monday ${anchorStr}${dryRun ? " — DRY RUN" : ""}`);
  for (const e of events) {
    const date = e.start_date_local.slice(0, 10);
    if (taken.has(date)) {
      console.log(`  skip    ${date} — ${e.name} (day already has an event)`);
      continue;
    }
    if (dryRun) {
      console.log(`  would   ${date} — ${e.name} (${e.type})`);
      continue;
    }
    await client.createEvent(e);
    console.log(`  created ${date} — ${e.name} (${e.type})`);
  }
  console.log(dryRun ? "Dry run — nothing pushed." : "Done.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
