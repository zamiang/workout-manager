// Inspect the Intervals.icu calendar for a date range.
//
//   npm run events                          # next 7 days from today
//   npm run events -- 2026-06-08 2026-06-14 # explicit oldest..newest
//   npm run events -- 2026-06-08            # 7 days from the given date
//
// Useful before/after push-week to confirm what's actually on the calendar.
import { config as loadEnv } from "dotenv";
loadEnv({ quiet: true });
import { IntervalsClient } from "../src/intervals.js";

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const oldest = args[0] ?? new Date().toISOString().slice(0, 10);
const newest = args[1] ?? addDays(oldest, 6);

const client = new IntervalsClient(process.env.INTERVALS_API_KEY!);
const events = await client.getEvents(oldest, newest);

if (events.length === 0) {
  console.log(`No events between ${oldest} and ${newest}.`);
} else {
  console.log(`Events ${oldest} .. ${newest}:`);
  for (const e of events.sort((a, b) => a.start_date_local.localeCompare(b.start_date_local))) {
    console.log(`  ${e.start_date_local.slice(0, 10)}  ${e.name}  [${e.type ?? e.category}]`);
  }
}
