import { describe, expect, it } from "vitest";
import { ingestEventsSkippingNotFound, isTbaNotFound } from "./perEvent.js";

// The exact message `tbaFetch` throws for a non-OK response.
const tbaError = (path: string, status: number): Error => new Error(`TBA request failed: ${path} -> HTTP ${status}`);

describe("isTbaNotFound", () => {
  it("is true only for tbaFetch's 404", () => {
    expect(isTbaNotFound(tbaError("/event/2026cascc/matches", 404))).toBe(true);
    expect(isTbaNotFound(tbaError("/event/2026cascc/matches", 500))).toBe(false);
    expect(isTbaNotFound(tbaError("/event/2026cascc/matches", 4040))).toBe(false);
    expect(isTbaNotFound(new Error("fetch failed"))).toBe(false);
    expect(isTbaNotFound("HTTP 404")).toBe(false);
  });
});

describe("ingestEventsSkippingNotFound", () => {
  it("skips and names an event that 404s, and ingests every other event in order", async () => {
    const ingested: string[] = [];
    const lines: string[] = [];
    const skipped = await ingestEventsSkippingNotFound(
      ["2026casac", "2026cascc", "2026casd"],
      async (eventKey) => {
        if (eventKey === "2026cascc") throw tbaError(`/event/${eventKey}/matches`, 404);
        ingested.push(eventKey);
      },
      (line) => lines.push(line)
    );
    expect(ingested).toEqual(["2026casac", "2026casd"]);
    expect(skipped).toEqual(["2026cascc"]);
    expect(lines).toEqual(["  2026cascc: TBA request failed: /event/2026cascc/matches -> HTTP 404, skipping"]);
  });

  it("still throws any other failure and stops the season there", async () => {
    const ingested: string[] = [];
    await expect(
      ingestEventsSkippingNotFound(["a", "b", "c"], async (eventKey) => {
        if (eventKey === "b") throw tbaError("/event/b/matches", 503);
        ingested.push(eventKey);
      }, () => {})
    ).rejects.toThrow("HTTP 503");
    expect(ingested).toEqual(["a"]);
  });
});
