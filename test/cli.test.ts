import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/cli.js";

describe("parseArgs", () => {
  it("parses 'plan' command", () => {
    const result = parseArgs(["plan"]);
    expect(result).toEqual({ command: "plan", dryRun: false });
  });

  it("parses 'plan --dry-run' command", () => {
    const result = parseArgs(["plan", "--dry-run"]);
    expect(result).toEqual({ command: "plan", dryRun: true });
  });

  it("parses 'status' command", () => {
    const result = parseArgs(["status"]);
    expect(result).toEqual({ command: "status", dryRun: false });
  });

  it("throws on unknown command", () => {
    expect(() => parseArgs(["foo"])).toThrow("Unknown command");
  });

  it("throws on no command", () => {
    expect(() => parseArgs([])).toThrow("No command");
  });
});
