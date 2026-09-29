/**
 * Mirrors `teams.test.ts`'s coverage exactly, for the events fetcher.
 * Fixtures are built by constructing an object that satisfies
 * `EventsArtifactSchema` (imported from the real schema module) rather than
 * pasting a captured payload (05-07-PLAN.md Task 1).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventsArtifactSchema, PAGE_ARTIFACT_SCHEMA_VERSION, type EventsArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { fetchEventsArtifact } from "./events.js";
import { ArtifactFetchError, ArtifactValidationError } from "./errors.js";

function makeValidArtifact(): EventsArtifact {
  const artifact = {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-08-24T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: "2.0.0+tuned-2026-08",
    season: 2025,
    events: [
      {
        eventKey: "2025alhu",
        name: "Rocket City Regional",
        eventType: 0,
        isOffseason: false,
        startDate: "2025-03-12",
        week: 2,
        teamCount: 44,
        matchCount: 96,
        playedMatchCount: 96,
        country: "USA",
        stateProv: "AL",
        districtKey: null,
      },
    ],
  };
  return EventsArtifactSchema.parse(artifact);
}

describe("fetchEventsArtifact", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("parses a well-formed fixture and returns typed rows", async () => {
    const artifact = makeValidArtifact();
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(artifact), { status: 200 }));

    const result = await fetchEventsArtifact({ year: 2025, algorithmId: "spr", version: "2.0.0+tuned-2026-08" });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.eventKey).toBe("2025alhu");
    expect(result.events[0]?.districtKey).toBeNull();
  });

  it("raises ArtifactFetchError with the status on a non-OK response", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));

    let caught: unknown;
    try {
      await fetchEventsArtifact({ year: 2025, algorithmId: "spr", version: "2.0.0+tuned-2026-08" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ArtifactFetchError);
    expect((caught as ArtifactFetchError).status).toBe(404);
    expect((caught as ArtifactFetchError).resource).toBe("events");
    expect((caught as ArtifactFetchError).year).toBe(2025);
  });

  it("raises ArtifactValidationError (not a bare throw) when a body fails schema validation", async () => {
    const artifact = makeValidArtifact() as Record<string, unknown>;
    delete artifact.season; // required field, per EventsArtifactSchema
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(artifact), { status: 200 }));

    await expect(fetchEventsArtifact({ year: 2025, algorithmId: "spr", version: "2.0.0+tuned-2026-08" })).rejects.toBeInstanceOf(ArtifactValidationError);
  });

  it("requests the exact key-built URL via the shared key builder and origin helper", async () => {
    const artifact = makeValidArtifact();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(artifact), { status: 200 }));
    global.fetch = fetchMock;

    await fetchEventsArtifact({ year: 2025, algorithmId: "spr", version: "2.0.0+tuned-2026-08" });

    expect(fetchMock).toHaveBeenCalledWith("https://data.sigmascout.org/v1/events/2025/spr@2.0.0+tuned-2026-08.json");
  });
});

describe("fetchEventsArtifact: cancelled rows (quick task 260929-mcf)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function row(eventKey: string, startDate: string, playedMatchCount: number) {
    return {
      eventKey,
      name: eventKey,
      eventType: 0,
      isOffseason: false,
      startDate,
      week: null,
      teamCount: 0,
      matchCount: playedMatchCount,
      playedMatchCount,
      country: null,
      stateProv: null,
      districtKey: null,
    };
  }

  function respondWith(computedAt: string): void {
    const artifact = {
      ...makeValidArtifact(),
      computedAt,
      events: [row("2020casj", "2020-03-19", 0), row("2026soon", "2026-10-03", 0), row("2026edge", "2026-09-24", 0), row("2025alhu", "2025-03-12", 96)],
    };
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(artifact), { status: 200 }));
  }

  const params = { year: 2026, algorithmId: "spr", version: "2.0.0+tuned-2026-08" };

  it("drops the row cancelled at the artifact's computedAt and keeps the rest in input order", async () => {
    respondWith("2026-09-28T12:00:00.000Z");
    const result = await fetchEventsArtifact(params);
    expect(result.events.map((e) => e.eventKey)).toEqual(["2026soon", "2026edge", "2025alhu"]);
  });

  it("judges by the artifact's computedAt, never the browser clock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-06-01T00:00:00.000Z"));
    respondWith("2026-09-28T12:00:00.000Z");
    const result = await fetchEventsArtifact(params);
    expect(result.events.map((e) => e.eventKey)).toContain("2026soon");
  });

  it("keeps every row when computedAt does not parse", async () => {
    const artifact = { ...makeValidArtifact(), computedAt: "not-a-date", events: [row("2020casj", "2020-03-19", 0), row("2025alhu", "2025-03-12", 96)] };
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(artifact), { status: 200 }));
    // Non-vacuity: the schema accepts any non-empty computedAt, so the guard is reachable.
    expect(EventsArtifactSchema.safeParse(artifact).success).toBe(true);
    const result = await fetchEventsArtifact(params);
    expect(result.events.map((e) => e.eventKey)).toEqual(["2020casj", "2025alhu"]);
  });
});
