// Host-local calendar dates. The planner reasons about the day the athlete is
// actually living in — using UTC (via toISOString) can roll "today" to tomorrow
// late in the evening on negative-offset hosts, shifting the whole window.

export function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayLocal(): string {
  return toLocalISODate(new Date());
}

// Pure string-date arithmetic anchored at local midnight, returning a local
// YYYY-MM-DD. Safe across month/year boundaries and DST (date-only).
export function addLocalDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toLocalISODate(d);
}
