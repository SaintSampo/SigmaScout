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
    algorithmId: "vpr",
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

    const result = await fetchEventsArtifact({ year: 2025, algorithmId: "vpr", version: "2.0.0+tuned-2026-08" });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.eventKey).toBe("2025alhu");
    expect(result.events[0]?.districtKey).toBeNull();
  });

  it("raises ArtifactFetchError with the status on a non-OK response", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));

    let caught: unknown;
    try {
      await fetchEventsArtifact({ year: 2025, algorithmId: "vpr", version: "2.0.0+tuned-2026-08" });
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

    await expect(fetchEventsArtifact({ year: 2025, algorithmId: "vpr", version: "2.0.0+tuned-2026-08" })).rejects.toBeInstanceOf(ArtifactValidationError);
  });

  it("requests the exact key-built URL via the shared key builder and origin helper", async () => {
    const artifact = makeValidArtifact();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(artifact), { status: 200 }));
    global.fetch = fetchMock;

    await fetchEventsArtifact({ year: 2025, algorithmId: "vpr", version: "2.0.0+tuned-2026-08" });

    expect(fetchMock).toHaveBeenCalledWith("https://data.sigmascout.org/v1/events/2025/vpr@2.0.0+tuned-2026-08.json");
  });
});
