import type { IntervalsEvent, TrainingLoad } from "./types.js";

const BASE_URL = "https://intervals.icu/api/v1";
// "0" is Intervals.icu's convention for the authenticated user — resolves to
// whoever owns the API key.
const ATHLETE_ID = "0";

type FetchFn = typeof globalThis.fetch;

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

  async getTrainingLoad(date: string): Promise<TrainingLoad> {
    const url = `${BASE_URL}/athlete/${ATHLETE_ID}/wellness?oldest=${date}&newest=${date}`;
    const res = await this.fetch(url, { headers: this.headers });
    if (!res.ok) {
      throw new Error(`Intervals.icu API error (${res.status}): ${await res.text()}`);
    }
    const data = await res.json();
    // Wellness endpoint returns an array for date ranges; empty on days with
    // no recorded wellness (e.g. today before sync).
    const entry = Array.isArray(data) ? data[0] : data;
    if (!entry || typeof entry !== "object") {
      return { ctl: 0, atl: 0, tsb: 0 };
    }
    const e = entry as Record<string, unknown>;
    const ctl = typeof e.ctl === "number" ? e.ctl : 0;
    const atl = typeof e.atl === "number" ? e.atl : 0;
    return {
      ctl,
      atl,
      tsb: typeof e.tsb === "number" ? e.tsb : ctl - atl,
    };
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
