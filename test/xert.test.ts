import { describe, it, expect, vi, beforeEach } from "vitest";
import { XertClient } from "../src/xert.js";

const MOCK_TOKEN_RESPONSE = {
  access_token: "test-token-123",
  refresh_token: "refresh-456",
  token_type: "Bearer",
  expires_in: 3600,
};

const MOCK_TRAINING_INFO = {
  ftp: 250,
  ltp: 210,
  hie: 22,
  pp: 1100,
  training_status: "Tired",
  focus: "Endurance",
  wotd_name: "Easy Endurance Ride",
  wotd_description: "60 min zone 2",
};

describe("XertClient", () => {
  let client: XertClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    client = new XertClient("user@example.com", "password123", mockFetch);
  });

  describe("authenticate", () => {
    it("obtains an access token via password grant", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_TOKEN_RESPONSE,
      });

      await client.authenticate();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://www.xertonline.com/oauth/token",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: expect.stringContaining("grant_type=password"),
        }),
      );
    });

    it("throws on failed auth", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Bad credentials",
      });

      await expect(client.authenticate()).rejects.toThrow("Xert auth failed (401)");
    });
  });

  describe("getTrainingInfo", () => {
    it("fetches training info with bearer token", async () => {
      // First call: auth
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_TOKEN_RESPONSE,
      });
      // Second call: training_info
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_TRAINING_INFO,
      });

      await client.authenticate();
      const info = await client.getTrainingInfo();

      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://www.xertonline.com/oauth/training_info",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token-123",
          }),
        }),
      );
      expect(info.ftp).toBe(250);
      expect(info.focus).toBe("Endurance");
    });

    it("throws if not authenticated", async () => {
      await expect(client.getTrainingInfo()).rejects.toThrow("Not authenticated");
    });
  });
});
