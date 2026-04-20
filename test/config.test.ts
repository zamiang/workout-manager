import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wp-config-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const VALID_YAML = `
weight_training:
  name: "Strength Session"
  duration_minutes: 60
  description: "Squat 3x8, Deadlift 3x5"

low_cadence:
  name: "Low Cadence Intervals"
  duration_minutes: 60
  description: "4x10min at 60rpm"

scheduling:
  tsb_fresh: 5
  tsb_fatigued: -10
  weight_sessions: 2
  min_weight_gap_days: 2
`;

describe("loadConfig", () => {
  it("parses a valid config file", async () => {
    const file = path.join(tmpDir, "config.yaml");
    await fs.writeFile(file, VALID_YAML, "utf8");

    const config = await loadConfig(file);

    expect(config.weight_training.name).toBe("Strength Session");
    expect(config.weight_training.duration_minutes).toBe(60);
    expect(config.low_cadence.name).toBe("Low Cadence Intervals");
    expect(config.scheduling.tsb_fresh).toBe(5);
    expect(config.scheduling.tsb_fatigued).toBe(-10);
    expect(config.scheduling.weight_sessions).toBe(2);
  });

  it("applies defaults for missing scheduling fields", async () => {
    const minimal = `
weight_training:
  name: "Strength"
  duration_minutes: 45
  description: "Basic routine"

low_cadence:
  name: "Low Cadence"
  duration_minutes: 60
  description: "Slow grinding"
`;
    const file = path.join(tmpDir, "config.yaml");
    await fs.writeFile(file, minimal, "utf8");

    const config = await loadConfig(file);

    expect(config.scheduling.tsb_fresh).toBe(5);
    expect(config.scheduling.tsb_fatigued).toBe(-10);
    expect(config.scheduling.tsb_very_fatigued).toBe(-20);
    expect(config.scheduling.weight_sessions).toBe(2);
    expect(config.scheduling.weight_sessions_very_fatigued).toBe(1);
    expect(config.scheduling.min_weight_gap_days).toBe(2);
  });

  it("throws if weight_training is missing", async () => {
    const bad = `
low_cadence:
  name: "Low Cadence"
  duration_minutes: 60
  description: "test"
`;
    const file = path.join(tmpDir, "config.yaml");
    await fs.writeFile(file, bad, "utf8");

    await expect(loadConfig(file)).rejects.toThrow("weight_training");
  });

  it("throws if low_cadence is missing", async () => {
    const bad = `
weight_training:
  name: "Strength"
  duration_minutes: 60
  description: "test"
`;
    const file = path.join(tmpDir, "config.yaml");
    await fs.writeFile(file, bad, "utf8");

    await expect(loadConfig(file)).rejects.toThrow("low_cadence");
  });

  it("applies a single scheduling override while keeping other defaults", async () => {
    const yaml = `
weight_training:
  name: "Strength"
  duration_minutes: 60
  description: "test"

low_cadence:
  name: "LC"
  duration_minutes: 60
  description: "test"

scheduling:
  tsb_fresh: 10
`;
    const file = path.join(tmpDir, "config.yaml");
    await fs.writeFile(file, yaml, "utf8");

    const config = await loadConfig(file);
    expect(config.scheduling.tsb_fresh).toBe(10);
    expect(config.scheduling.tsb_fatigued).toBe(-10);
    expect(config.scheduling.weight_sessions).toBe(2);
    expect(config.scheduling.min_weight_gap_days).toBe(2);
  });

  it("throws when a scheduling field has the wrong type", async () => {
    const yaml = `
weight_training:
  name: "Strength"
  duration_minutes: 60
  description: "test"

low_cadence:
  name: "LC"
  duration_minutes: 60
  description: "test"

scheduling:
  tsb_fresh: "five"
`;
    const file = path.join(tmpDir, "config.yaml");
    await fs.writeFile(file, yaml, "utf8");

    await expect(loadConfig(file)).rejects.toThrow("tsb_fresh");
  });
});
