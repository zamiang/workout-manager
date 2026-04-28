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

    it("returns zeros when the wellness response is an empty array", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const load = await client.getTrainingLoad("2026-04-19");
      expect(load).toEqual({ ctl: 0, atl: 0, tsb: 0 });
    });

    it("defaults missing ctl/atl to zero and derives tsb from ctl - atl", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: "2026-04-19", ctl: 55 }],
      });

      const load = await client.getTrainingLoad("2026-04-19");
      expect(load).toEqual({ ctl: 55, atl: 0, tsb: 55 });
    });
  });

  describe("getTrainingLoadRange", () => {
    it("returns parsed wellness entries with dates from the `id` field", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: "2026-04-19", ctl: 55, atl: 60, tsb: -5 },
          { id: "2026-04-20", ctl: 56, atl: 62, tsb: -6 },
        ],
      });

      const range = await client.getTrainingLoadRange("2026-04-19", "2026-04-20");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://intervals.icu/api/v1/athlete/0/wellness?oldest=2026-04-19&newest=2026-04-20",
        expect.any(Object),
      );
      expect(range).toEqual([
        { date: "2026-04-19", ctl: 55, atl: 60, tsb: -5 },
        { date: "2026-04-20", ctl: 56, atl: 62, tsb: -6 },
      ]);
    });

    it("returns empty array when the response is not an array", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => null,
      });
      const range = await client.getTrainingLoadRange("2026-04-19", "2026-04-20");
      expect(range).toEqual([]);
    });
  });

  describe("getActivities", () => {
    it("fetches activities and normalizes the fields we care about", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            id: "i12345",
            start_date_local: "2026-04-19T08:00:00",
            type: "Ride",
            icu_training_load: 78,
            icu_intensity: 0.82,
            icu_zone_times: [600, 1200, 1800, 600, 0, 0, 0],
          },
          {
            id: "i12346",
            start_date_local: "2026-04-20T07:30:00",
            type: "Run",
            icu_training_load: 45,
            // missing icu_intensity / icu_zone_times — should null out
          },
        ],
      });

      const activities = await client.getActivities("2026-04-19", "2026-04-20");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://intervals.icu/api/v1/athlete/0/activities?oldest=2026-04-19&newest=2026-04-20",
        expect.any(Object),
      );
      expect(activities).toHaveLength(2);
      expect(activities[0]).toEqual({
        id: "i12345",
        start_date_local: "2026-04-19T08:00:00",
        type: "Ride",
        icu_training_load: 78,
        icu_intensity: 0.82,
        icu_zone_times: [600, 1200, 1800, 600, 0, 0, 0],
      });
      expect(activities[1].icu_intensity).toBeNull();
      expect(activities[1].icu_zone_times).toBeNull();
    });

    it("returns empty array when response is not an array", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });
      const activities = await client.getActivities("2026-04-19", "2026-04-20");
      expect(activities).toEqual([]);
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
