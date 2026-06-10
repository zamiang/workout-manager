import { describe, it, expect } from "vitest";
import { planPushActions } from "../scripts/push-week.js";
import type { IntervalsEvent } from "../src/types.js";

const ev = (date: string, name: string, id?: number): IntervalsEvent => ({
  ...(id !== undefined ? { id } : {}),
  start_date_local: `${date}T00:00:00`,
  name,
  category: "WORKOUT",
});

describe("planPushActions", () => {
  it("skips days that already have an event (default mode)", () => {
    const actions = planPushActions([ev("2026-06-10", "New Ride")], [ev("2026-06-10", "Old", 1)], false);
    expect(actions).toEqual([
      { kind: "skip", date: "2026-06-10", event: actions[0].event, reason: "day already has an event" },
    ]);
  });

  it("creates on empty days (default mode)", () => {
    const actions = planPushActions([ev("2026-06-10", "New Ride")], [], false);
    expect(actions[0].kind).toBe("create");
  });

  it("matches each session to a distinct existing event on a stacked day (--replace)", () => {
    const events = [ev("2026-06-10", "Hard Ride"), ev("2026-06-10", "Strength")];
    const existing = [ev("2026-06-10", "Old Ride", 11), ev("2026-06-10", "Old Lift", 22)];
    const actions = planPushActions(events, existing, true);
    expect(actions.map((a) => a.kind)).toEqual(["update", "update"]);
    expect(actions.map((a) => (a.kind === "update" ? a.priorId : null))).toEqual([11, 22]);
  });

  it("creates the overflow session when fewer existing events than sessions (--replace)", () => {
    const events = [ev("2026-06-10", "Hard Ride"), ev("2026-06-10", "Strength")];
    const existing = [ev("2026-06-10", "Old Ride", 11)];
    const actions = planPushActions(events, existing, true);
    expect(actions.map((a) => a.kind)).toEqual(["update", "create"]);
  });

  it("skips an existing event with no id under --replace", () => {
    const actions = planPushActions([ev("2026-06-10", "Ride")], [ev("2026-06-10", "Old")], true);
    expect(actions[0]).toMatchObject({ kind: "skip", reason: "existing event has no id; cannot replace" });
  });
});
