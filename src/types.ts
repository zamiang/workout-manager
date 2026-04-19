// --- Config ---

export interface WorkoutDefinition {
  name: string;
  duration_minutes: number;
  description: string;
}

export interface SchedulingConfig {
  tsb_fresh: number; // default 5
  tsb_fatigued: number; // default -10
  weight_sessions: number; // default 2
  min_weight_gap_days: number; // default 2
}

export interface Config {
  weight_training: WorkoutDefinition;
  low_cadence: WorkoutDefinition;
  scheduling: SchedulingConfig;
}

// --- Intervals.icu ---

export interface IntervalsEvent {
  id?: number;
  start_date_local: string; // YYYY-MM-DD
  name: string;
  category: string; // "WORKOUT", "NOTE", etc.
  description?: string;
  type?: string; // "Ride", "WeightTraining", etc.
}

export interface TrainingLoad {
  ctl: number; // chronic training load (fitness)
  atl: number; // acute training load (fatigue)
  tsb: number; // training stress balance (form)
}

// --- Xert ---

export interface XertTrainingInfo {
  ftp: number;
  ltp: number;
  hie: number;
  pp: number; // peak power
  training_status: string;
  focus: string; // recommended focus type
  wotd_name?: string;
  wotd_description?: string;
}

// --- Scheduler ---

export type WorkoutType = "cycling" | "low_cadence" | "weights" | "rest";

export type CyclingIntensity = "easy" | "moderate" | "hard";

export interface PlannedWorkout {
  date: string; // YYYY-MM-DD
  type: WorkoutType;
  name: string;
  description: string;
  intensity: CyclingIntensity | "hard"; // weights and low_cadence are always "hard"
}

export interface SchedulerInput {
  startDate: string; // YYYY-MM-DD, first day of planning window
  existingEvents: IntervalsEvent[];
  trainingLoad: TrainingLoad;
  xertInfo: XertTrainingInfo;
  config: Config;
}
