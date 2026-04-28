import type { Activity, IntervalsEvent, TrainingLoad, WellnessEntry } from "./types.js";

const BASE_URL = "https://intervals.icu/api/v1";
// "0" is Intervals.icu's convention for the authenticated user — resolves to
// whoever owns the API key.
const ATHLETE_ID = "0";

type FetchFn = typeof globalThis.fetch;

function parseWellnessEntry(raw: unknown): TrainingLoad {
  if (!raw || typeof raw !== "object") {
    return { ctl: 0, atl: 0, tsb: 0 };
  }
  const e = raw as Record<string, unknown>;
  const ctl = typeof e.ctl === "number" ? e.ctl : 0;
  const atl = typeof e.atl === "number" ? e.atl : 0;
  return {
    ctl,
    atl,
    tsb: typeof e.tsb === "number" ? e.tsb : ctl - atl,
  };
}

export class IntervalsClient {
  private headers: Record<string, string>;
  private fetch: FetchFn;

  constructor(apiKey: string, fetchFn: FetchFn = globalThis.fetch) {
    const encoded = Buffer.from(`API_KEY:${apiKey}`).toString("base64");
    this.headers = {
      Authorization: `Basic ${encoded}`,
      "Content-Type": "application/json",
    };
    this.fetch = fetchFn;
  }

  async getEvents(oldest: string, newest: string): Promise<IntervalsEvent[]> {
    const url = `${BASE_URL}/athlete/${ATHLETE_ID}/events?oldest=${oldest}&newest=${newest}`;
    const res = await this.fetch(url, { headers: this.headers });
    if (!res.ok) {
      throw new Error(`Intervals.icu API error (${res.status}): ${await res.text()}`);
    }
    return res.json();
  }

  async getTrainingLoadRange(oldest: string, newest: string): Promise<WellnessEntry[]> {
    const url = `${BASE_URL}/athlete/${ATHLETE_ID}/wellness?oldest=${oldest}&newest=${newest}`;
    const res = await this.fetch(url, { headers: this.headers });
    if (!res.ok) {
      throw new Error(`Intervals.icu API error (${res.status}): ${await res.text()}`);
    }
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((entry) => {
      const load = parseWellnessEntry(entry);
      const date =
        entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).id === "string"
          ? ((entry as Record<string, unknown>).id as string)
          : "";
      return { date, ...load };
    });
  }

  async getTrainingLoad(date: string): Promise<TrainingLoad> {
    const range = await this.getTrainingLoadRange(date, date);
    if (range.length === 0) return { ctl: 0, atl: 0, tsb: 0 };
    const { ctl, atl, tsb } = range[0];
    return { ctl, atl, tsb };
  }

  async getActivities(oldest: string, newest: string): Promise<Activity[]> {
    const url = `${BASE_URL}/athlete/${ATHLETE_ID}/activities?oldest=${oldest}&newest=${newest}`;
    const res = await this.fetch(url, { headers: this.headers });
    if (!res.ok) {
      throw new Error(`Intervals.icu API error (${res.status}): ${await res.text()}`);
    }
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((raw) => {
      const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      return {
        id: typeof a.id === "string" ? a.id : String(a.id ?? ""),
        start_date_local: typeof a.start_date_local === "string" ? a.start_date_local : "",
        type: typeof a.type === "string" ? a.type : "",
        icu_training_load: typeof a.icu_training_load === "number" ? a.icu_training_load : 0,
        icu_intensity: typeof a.icu_intensity === "number" ? a.icu_intensity : null,
        // Intervals returns icu_zone_times as either an array of seconds-per-zone
        // or as an object keyed by zone name; pass through whichever is present.
        icu_zone_times: Array.isArray(a.icu_zone_times) ? (a.icu_zone_times as number[]) : null,
      };
    });
  }

  async createEvent(event: IntervalsEvent): Promise<IntervalsEvent> {
    const url = `${BASE_URL}/athlete/${ATHLETE_ID}/events`;
    const res = await this.fetch(url, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(event),
    });
    if (!res.ok) {
      throw new Error(`Intervals.icu API error (${res.status}): ${await res.text()}`);
    }
    return res.json();
  }
}
