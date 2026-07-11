import { describe, it, expect, vi } from "vitest";
import { latestEftp, planFtpSync, renderTargets, syncFtp } from "../src/ftp.js";
import type { Activity, FtpSyncConfig } from "../src/types.js";

const CFG: FtpSyncConfig = { enabled: true, max_change_pct: 10 };

function activity(overrides: Partial<Activity>): Activity {
  return {
    id: "a1",
    start_date_local: "2026-07-01T08:00:00",
    start_date: "2026-07-01T12:00:00Z",
    type: "Ride",
    icu_training_load: 50,
    icu_intensity: 0.7,
    icu_zone_times: null,
    icu_ss_time: null,
    ...overrides,
  };
}

describe("latestEftp", () => {
  it("returns the most recent activity's rolling FTP", () => {
    const eftp = latestEftp([
      activity({ start_date_local: "2026-07-01T08:00:00", icu_rolling_ftp: 235 }),
      activity({ start_date_local: "2026-07-03T08:00:00", icu_rolling_ftp: 232 }),
      activity({ start_date_local: "2026-07-02T08:00:00", icu_rolling_ftp: 234 }),
    ]);
    expect(eftp).toBe(232);
  });

  it("skips activities without a usable estimate (missing, null, or 0)", () => {
    const eftp = latestEftp([
      activity({ start_date_local: "2026-07-01T08:00:00", icu_rolling_ftp: 233 }),
      activity({ start_date_local: "2026-07-02T08:00:00", icu_rolling_ftp: null }),
      activity({ start_date_local: "2026-07-03T08:00:00", icu_rolling_ftp: 0 }),
      activity({ start_date_local: "2026-07-04T08:00:00" }),
    ]);
    expect(eftp).toBe(233);
  });

  it("returns undefined when no activity carries an estimate", () => {
    expect(latestEftp([activity({})])).toBeUndefined();
    expect(latestEftp([])).toBeUndefined();
  });
});

describe("planFtpSync", () => {
  it("applies a modest eFTP change", () => {
    expect(planFtpSync(235, 232, CFG)).toEqual({ action: "apply", target: 232 });
  });

  it("rounds a fractional eFTP before comparing", () => {
    expect(planFtpSync(235, 234.6, CFG)).toEqual({
      action: "skip",
      reason: expect.stringContaining("already matches"),
    });
  });

  it("skips when eFTP matches the settings FTP", () => {
    const d = planFtpSync(235, 235, CFG);
    expect(d.action).toBe("skip");
  });

  it("refuses a jump beyond max_change_pct as bad data", () => {
    const d = planFtpSync(235, 300, CFG);
    expect(d).toMatchObject({ action: "skip" });
    expect((d as { reason: string }).reason).toContain("max_change_pct");
  });

  it("applies eFTP when no settings FTP exists (no baseline to clamp against)", () => {
    expect(planFtpSync(null, 232, CFG)).toEqual({ action: "apply", target: 232 });
  });

  it("skips when disabled or when no eFTP is available", () => {
    expect(planFtpSync(235, 232, { ...CFG, enabled: false }).action).toBe("skip");
    expect(planFtpSync(235, undefined, CFG).action).toBe("skip");
  });
});

describe("renderTargets", () => {
  const values = { ftp: 232, lthr: 160 };

  it("renders {ftp}, {lthr}, single percentages, and ranges", () => {
    expect(renderTargets("Z2 ~{w:62}W at {ftp}W FTP, HR under {hr:83} / LTHR {lthr}", values)).toBe(
      "Z2 ~144W at 232W FTP, HR under 133 / LTHR 160",
    );
    expect(renderTargets("3x12m @ 88-94% FTP (~{w:88-94}W)", values)).toBe(
      "3x12m @ 88-94% FTP (~204-218W)",
    );
    expect(renderTargets("{hr:80-90} bpm", values)).toBe("128-144 bpm");
  });

  it("leaves text without placeholders untouched", () => {
    const text = "Lift heavy, log band + rope setting (e.g. 37 Gray -2).";
    expect(renderTargets(text, values)).toBe(text);
  });

  it("throws when a needed value is missing", () => {
    expect(() => renderTargets("~{w:62}W", { ftp: null, lthr: 160 })).toThrow(/no FTP/);
    expect(() => renderTargets("under {hr:83}", { ftp: 232, lthr: null })).toThrow(/no LTHR/);
  });

  it("throws on a malformed placeholder instead of pushing literal braces", () => {
    expect(() => renderTargets("~{w:62%}W", values)).toThrow(/Malformed target placeholder/);
    expect(() => renderTargets("{hr:abc}", values)).toThrow(/Malformed target placeholder/);
    // ftp/lthr take no argument — a colon suffix is a typo, not a silent no-op
    expect(() => renderTargets("at {ftp:50}W", values)).toThrow(/Malformed target placeholder/);
    expect(() => renderTargets("{lthr:xyz}", values)).toThrow(/Malformed target placeholder/);
  });
});

describe("syncFtp", () => {
  const settings = { id: 7, ftp: 235, lthr: 160 };
  const rides = [activity({ icu_rolling_ftp: 232 })];

  it("writes the eFTP to the sport settings and returns it for rendering", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const out = await syncFtp({ updateSportSettings: update }, settings, rides, CFG, {
      dryRun: false,
      log: () => {},
    });
    expect(update).toHaveBeenCalledWith(7, { ftp: 232 });
    expect(out).toEqual({ ftp: 232, lthr: 160 });
  });

  it("does not write on --dry-run but still returns the would-be FTP", async () => {
    const update = vi.fn();
    const out = await syncFtp({ updateSportSettings: update }, settings, rides, CFG, {
      dryRun: true,
      log: () => {},
    });
    expect(update).not.toHaveBeenCalled();
    expect(out).toEqual({ ftp: 232, lthr: 160 });
  });

  it("keeps the settings FTP when the sync skips (guard or disabled)", async () => {
    const update = vi.fn();
    const guarded = await syncFtp(
      { updateSportSettings: update },
      settings,
      [activity({ icu_rolling_ftp: 300 })],
      CFG,
      { dryRun: false, log: () => {} },
    );
    expect(update).not.toHaveBeenCalled();
    expect(guarded).toEqual({ ftp: 235, lthr: 160 });

    const disabled = await syncFtp(
      { updateSportSettings: update },
      settings,
      rides,
      {
        ...CFG,
        enabled: false,
      },
      { dryRun: false, log: () => {} },
    );
    expect(disabled).toEqual({ ftp: 235, lthr: 160 });
  });

  it("returns nulls (and skips) when there is no Ride settings entry", async () => {
    const update = vi.fn();
    const out = await syncFtp({ updateSportSettings: update }, null, rides, CFG, {
      dryRun: false,
      log: () => {},
    });
    expect(update).not.toHaveBeenCalled();
    expect(out).toEqual({ ftp: null, lthr: null });
  });
});
