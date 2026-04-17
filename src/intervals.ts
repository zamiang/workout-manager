import type { IntervalsEvent, TrainingLoad } from "./types.js";

const BASE_URL = "https://intervals.icu/api/v1";
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
    const entry = Array.isArray(data) ? data[0] : data;
    return {
      ctl: entry.ctl ?? 0,
      atl: entry.atl ?? 0,
      tsb: entry.tsb ?? 0,
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
