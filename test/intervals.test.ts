import { describe, it, expect, vi, beforeEach } from "vitest";
import { IntervalsClient } from "../src/intervals.js";
import type { IntervalsEvent } from "../src/types.js";

const MOCK_EVENTS: IntervalsEvent[] = [
  {
    id: 1,
    start_date_local: "2026-04-20",
    name: "Morning Ride",
    category: "WORKOUT",
    type: "Ride",
  },
];

const MOCK_WELLNESS = [{ id: "2026-04-19", ctl: 55, atl: 60, tsb: -5 }];

describe("IntervalsClient", () => {
  let client: IntervalsClient;
  let mockFetch: ReturnType<typeof vi.fn> & typeof globalThis.fetch;

  beforeEach(() => {
    mockFetch = vi.fn() as typeof mockFetch;
    client = new IntervalsClient("test-api-key", mockFetch);
  });

  describe("getEvents", () => {
    it("fetches events for a date range", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_EVENTS,
      });

      const events = await client.getEvents("2026-04-20", "2026-04-26");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://intervals.icu/api/v1/athlete/0/events?oldest=2026-04-20&newest=2026-04-26",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringContaining("Basic"),
          }),
        }),
      );
      expect(events).toEqual(MOCK_EVENTS);
    });

    it("throws on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      await expect(client.getEvents("2026-04-20", "2026-04-26")).rejects.toThrow(
        "Intervals.icu API error (401)",
      );
    });
  });

  describe("getTrainingLoad", () => {
    it("fetches wellness data and extracts latest training load", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_WELLNESS,
      });

      const load = await client.getTrainingLoad("2026-04-19");

      expect(load).toEqual({ ctl: 55, atl: 60, tsb: -5 });
    });
  });

  describe("createEvent", () => {
    it("posts an event to the calendar", async () => {
      const event: IntervalsEvent = {
        start_date_local: "2026-04-21",
        name: "Strength Session",
        category: "WORKOUT",
        type: "WeightTraining",
        description: "Squats and stuff",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...event, id: 42 }),
      });

      const created = await client.createEvent(event);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://intervals.icu/api/v1/athlete/0/events",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(event),
        }),
      );
      expect(created.id).toBe(42);
    });
  });
});
