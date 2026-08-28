/**
 * Mirrors `apps/web/src/lib/api/teams.test.ts`'s own fixture-construction
 * discipline: build an object that satisfies `TeamSeasonArtifactSchema`
 * (imported from the real schema module) rather than pasting a captured
 * payload.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PAGE_ARTIFACT_SCHEMA_VERSION, TeamSeasonArtifactSchema, type TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { fetchTeamArtifact } from "./team.js";
import { ArtifactFetchError, ArtifactValidationError } from "./errors.js";

function makeValidArtifact(): TeamSeasonArtifact {
  const artifact = {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-08-24T00:00:00.000Z",
    algorithmId: "vpr",
    algorithmVersion: "2.0.0+tuned-2026-08",
    teamKey: "frc1114",
    teamNumber: 1114,
    nickname: "Simbotics",
    season: 2024,
    seasonStats: {
      record: { wins: 35, losses: 28, ties: 0 },
      metrics: { total: { value: 48.33, spread: 2.32 } },
    },
    events: [],
    metricHistory: [],
  };
  return TeamSeasonArtifactSchema.parse(artifact);
}

describe("fetchTeamArtifact", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("parses a well-formed fixture and returns a typed result", async () => {
    const artifact = makeValidArtifact();
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(artifact), { status: 200 }));

    const result = await fetchTeamArtifact({ teamKey: "frc1114", year: 2024, algorithmId: "vpr", version: "2.0.0+tuned-2026-08" });

    expect(result.teamNumber).toBe(1114);
    expect(result.nickname).toBe("Simbotics");
    expect(result.seasonStats.record).toEqual({ wins: 35, losses: 28, ties: 0 });
  });

  it("raises ArtifactFetchError with the status on a 404", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));

    let caught: unknown;
    try {
      await fetchTeamArtifact({ teamKey: "frc1114", year: 2024, algorithmId: "vpr", version: "2.0.0+tuned-2026-08" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ArtifactFetchError);
    expect((caught as ArtifactFetchError).status).toBe(404);
    expect((caught as ArtifactFetchError).resource).toBe("team");
    expect((caught as ArtifactFetchError).year).toBe(2024);
  });

  it("raises ArtifactValidationError (not a bare throw) when a required field is missing", async () => {
    const artifact = makeValidArtifact() as unknown as Record<string, unknown>;
    delete artifact.teamNumber; // required field, per TeamSeasonArtifactSchema
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(artifact), { status: 200 }));

    await expect(fetchTeamArtifact({ teamKey: "frc1114", year: 2024, algorithmId: "vpr", version: "2.0.0+tuned-2026-08" })).rejects.toBeInstanceOf(
      ArtifactValidationError,
    );
  });

  it("requests the exact key-built URL, proving artifactKey()'s team branch and the origin module are wired together", async () => {
    const artifact = makeValidArtifact();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(artifact), { status: 200 }));
    global.fetch = fetchMock;

    await fetchTeamArtifact({ teamKey: "frc1114", year: 2024, algorithmId: "vpr", version: "2.0.0+tuned-2026-08" });

    expect(fetchMock).toHaveBeenCalledWith("https://data.sigmascout.org/v1/team/frc1114/2024/vpr@2.0.0+tuned-2026-08.json");
  });
});
