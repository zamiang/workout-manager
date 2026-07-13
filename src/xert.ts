import type { XertTrainingInfo } from "./types.js";

const OAUTH_URL = "https://www.xertonline.com/oauth";

type FetchFn = typeof globalThis.fetch;

export class XertClient {
  private username: string;
  private password: string;
  private accessToken: string | null = null;
  private fetch: FetchFn;

  constructor(username: string, password: string, fetchFn: FetchFn = globalThis.fetch) {
    this.username = username;
    this.password = password;
    this.fetch = fetchFn;
  }

  async authenticate(): Promise<void> {
    const body = new URLSearchParams({
      grant_type: "password",
      username: this.username,
      password: this.password,
    });

    const res = await this.fetch(`${OAUTH_URL}/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + Buffer.from("xert_public:xert_public").toString("base64"),
      },
      body: body.toString(),
    });

    if (!res.ok) {
      throw new Error(`Xert auth failed (${res.status}): ${await res.text()}`);
    }

    const data = await res.json();
    if (!data || typeof data.access_token !== "string") {
      throw new Error("Xert auth succeeded but the response had no access_token");
    }
    this.accessToken = data.access_token;
  }

  async getTrainingInfo(): Promise<XertTrainingInfo> {
    if (!this.accessToken) {
      throw new Error("Not authenticated — call authenticate() first");
    }

    const res = await this.fetch(`${OAUTH_URL}/training_info`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    if (!res.ok) {
      throw new Error(`Xert API error (${res.status}): ${await res.text()}`);
    }

    // Coerce defensively — an OAuth endpoint can return a 200 with an error or
    // partial body, and these values feed straight into display. Mirrors the
    // parseEvent / parseWellnessEntry style on the Intervals.icu side.
    const obj = (v: unknown): Record<string, unknown> =>
      v && typeof v === "object" ? (v as Record<string, unknown>) : {};
    const num = (v: unknown): number => (typeof v === "number" ? v : 0);
    const str = (v: unknown): string => (typeof v === "string" ? v : "");
    const data = obj(await res.json());
    const sig = obj(data.signature);
    return {
      ftp: num(sig.ftp),
      ltp: num(sig.ltp),
      hie: num(sig.hie),
      pp: num(sig.pp),
      training_status: str(data.status),
      focus: str(data.focus),
    };
  }
}
