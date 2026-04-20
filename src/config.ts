import { promises as fs } from "node:fs";
import { parse } from "yaml";
import type { Config, SchedulingConfig, WorkoutDefinition } from "./types.js";

const SCHEDULING_DEFAULTS: SchedulingConfig = {
  tsb_fresh: 5,
  tsb_fatigued: -10,
  tsb_very_fatigued: -20,
  weight_sessions: 2,
  weight_sessions_very_fatigued: 1,
  min_weight_gap_days: 2,
};

function validateScheduling(raw: unknown): Partial<SchedulingConfig> {
  if (raw == null) return {};
  if (typeof raw !== "object") {
    throw new Error("scheduling must be an object");
  }
  const obj = raw as Record<string, unknown>;
  const out: Partial<SchedulingConfig> = {};
  const numericFields: (keyof SchedulingConfig)[] = [
    "tsb_fresh",
    "tsb_fatigued",
    "weight_sessions",
    "min_weight_gap_days",
  ];
  for (const field of numericFields) {
    if (obj[field] === undefined) continue;
    if (typeof obj[field] !== "number") {
      throw new Error(`scheduling.${field} must be a number`);
    }
    out[field] = obj[field] as number;
  }
  return out;
}

function validateWorkout(raw: unknown, field: string): WorkoutDefinition {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Config missing required field: ${field}`);
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== "string") {
    throw new Error(`${field}.name must be a string`);
  }
  if (typeof obj.duration_minutes !== "number") {
    throw new Error(`${field}.duration_minutes must be a number`);
  }
  if (typeof obj.description !== "string") {
    throw new Error(`${field}.description must be a string`);
  }
  return {
    name: obj.name,
    duration_minutes: obj.duration_minutes,
    description: obj.description,
  };
}

export async function loadConfig(filePath: string): Promise<Config> {
  const raw = await fs.readFile(filePath, "utf8");
  const doc = parse(raw);

  if (!doc || typeof doc !== "object") {
    throw new Error("Config file is empty or invalid YAML");
  }

  const weight_training = validateWorkout(doc.weight_training, "weight_training");
  const low_cadence = validateWorkout(doc.low_cadence, "low_cadence");

  const scheduling: SchedulingConfig = {
    ...SCHEDULING_DEFAULTS,
    ...validateScheduling(doc.scheduling),
  };

  return { weight_training, low_cadence, scheduling };
}
