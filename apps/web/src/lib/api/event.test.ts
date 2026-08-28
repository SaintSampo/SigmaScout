/**
 * Mirrors `apps/web/src/lib/api/team.test.ts`'s own fixture-construction
 * discipline: build an object that satisfies `EventArtifactSchema` (imported
 * from the real schema module) rather than pasting a captured payload.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventArtifactSchema, PAGE_ARTIFACT_SCHEMA_VERSION, type EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { fetchEventArtifact, type FetchEventArtifactParams } from "./event.js";
import { ArtifactFetchError, ArtifactValidationError } from "./errors.js";

// Compile-time-only assertion (07-01-PLAN.md Task 1's acceptance criteria):
// `FetchEventArtifactParams` has EXACTLY the keys `eventKey`, `algorithmId`
// and `version` — no `year` field. If a `year` were ever threaded back in,
// EITHER the `Exclude` below would stop resolving to `never` (a new required
// key) OR the `satisfies` object literal would fail to type-check (missing a
// newly-required key), so `pnpm --filter web typecheck` fails loudly either
// way.
type ExtraParamKeys = Exclude<keyof FetchEventArtifactParams, "eventKey" | "algorithmId" | "version">;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _noExtraKeys: ExtraParamKeys extends never ? true : false = true;
const _exactParams = {
  eventKey: "2024casf",
  algorithmId: "vpr",
  version: "2.0.0+tuned-2026-08",
} satisfies FetchEventArtifactParams;
void _exactParams;

function makeValidArtifact(): EventArtifact {
  const artifact = {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-08-24T00:00:00.000Z",
    algorithmId: "vpr",
    algorithmVersion: "2.0.0+tuned-2026-08",
    eventKey: "2024casf",
    season: 2024,
    matches: [],
    upcoming: [],
    teams: [{ teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs", metrics: { total: { value: 48.33, spread: 2.32 } } }],
  };
  return EventArtifactSchema.parse(artifact);
}

describe("fetchEventArtifact", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("parses a well-formed fixture and returns a typed result", async () => {
    const artifact = makeValidArtifact();
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(artifact), { status: 200 }));

    const result = await fetchEventArtifact({ eventKey: "2024casf", algorithmId: "vpr", version: "2.0.0+tuned-2026-08" });

    expect(result.eventKey).toBe("2024casf");
    expect(result.season).toBe(2024);
    expect(result.teams).toHaveLength(1);
  });

  it("raises ArtifactFetchError with the status on a 404, deriving year from the event key", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));

    let caught: unknown;
    try {
      await fetchEventArtifact({ eventKey: "2024casf", algorithmId: "vpr", version: "2.0.0+tuned-2026-08" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ArtifactFetchError);
    expect((caught as ArtifactFetchError).status).toBe(404);
    expect((caught as ArtifactFetchError).resource).toBe("event");
    expect((caught as ArtifactFetchError).year).toBe(2024);
  });

  it("raises ArtifactValidationError (not a bare throw) when the required teams key is missing", async () => {
    const artifact = makeValidArtifact() as unknown as Record<string, unknown>;
    delete artifact.teams; // required field, per EventArtifactSchema
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(artifact), { status: 200 }));

    await expect(
      fetchEventArtifact({ eventKey: "2024casf", algorithmId: "vpr", version: "2.0.0+tuned-2026-08" }),
    ).rejects.toBeInstanceOf(ArtifactValidationError);
  });

  it("requests the exact key-built URL, proving artifactKey()'s event branch and the origin module are wired together", async () => {
    const artifact = makeValidArtifact();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(artifact), { status: 200 }));
    global.fetch = fetchMock;

    await fetchEventArtifact({ eventKey: "2024casf", algorithmId: "vpr", version: "2.0.0+tuned-2026-08" });

    expect(fetchMock).toHaveBeenCalledWith("https://data.sigmascout.org/v1/event/2024casf/vpr@2.0.0+tuned-2026-08.json");
  });
});
