import type { XertTrainingInfo } from "./types.js";

const BASE_URL = "https://www.xertonline.com/oauth";

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

    const res = await this.fetch(`${BASE_URL}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      throw new Error(`Xert auth failed (${res.status}): ${await res.text()}`);
    }

    const data = await res.json();
    this.accessToken = data.access_token;
  }

  async getTrainingInfo(): Promise<XertTrainingInfo> {
    if (!this.accessToken) {
      throw new Error("Not authenticated — call authenticate() first");
    }

    const res = await this.fetch(`${BASE_URL}/training_info`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    if (!res.ok) {
      throw new Error(`Xert API error (${res.status}): ${await res.text()}`);
    }

    const data = await res.json();
    return {
      ftp: data.ftp,
      ltp: data.ltp,
      hie: data.hie,
      pp: data.pp,
      training_status: data.training_status ?? "",
      focus: data.focus ?? "",
      wotd_name: data.wotd_name ?? undefined,
      wotd_description: data.wotd_description ?? undefined,
    };
  }
}
