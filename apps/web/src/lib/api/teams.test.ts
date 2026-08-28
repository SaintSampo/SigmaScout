/**
 * Plan 05-01 Task 3, Step 6: the read path's test coverage. Fixtures are
 * built by constructing an object that satisfies `TeamsArtifactSchema`
 * (imported from the real schema module) rather than pasting a captured
 * payload, per the plan's own instruction.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamsArtifactSchema, PAGE_ARTIFACT_SCHEMA_VERSION, type TeamsArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { fetchTeamsArtifact } from "./teams.js";
import { ArtifactFetchError, ArtifactValidationError } from "./errors.js";

function makeValidArtifact(): TeamsArtifact {
  const artifact = {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-08-24T00:00:00.000Z",
    algorithmId: "vpr",
    algorithmVersion: "2.0.0+tuned-2026-08",
    season: 2024,
    teams: [
      {
        teamKey: "frc1114",
        teamNumber: 1114,
        nickname: "Simbotics",
        eventCount: 3,
        matchCount: 40,
        record: { wins: 30, losses: 10, ties: 0 },
        metrics: { total: { value: 42.5, spread: 3.1 } },
      },
    ],
  };
  return TeamsArtifactSchema.parse(artifact);
}

describe("fetchTeamsArtifact", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("parses a well-formed fixture and returns typed rows", async () => {
    const artifact = makeValidArtifact();
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(artifact), { status: 200 }));

    const result = await fetchTeamsArtifact({ year: 2024, algorithmId: "vpr", version: "2.0.0+tuned-2026-08" });

    expect(result.teams).toHaveLength(1);
    expect(result.teams[0]?.teamNumber).toBe(1114);
    expect(result.teams[0]?.metrics.total?.value).toBe(42.5);
  });

  it("raises ArtifactFetchError with the status on a 404", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));

    let caught: unknown;
    try {
      await fetchTeamsArtifact({ year: 2024, algorithmId: "vpr", version: "2.0.0+tuned-2026-08" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ArtifactFetchError);
    expect((caught as ArtifactFetchError).status).toBe(404);
    expect((caught as ArtifactFetchError).resource).toBe("teams");
    expect((caught as ArtifactFetchError).year).toBe(2024);
  });

  it("raises ArtifactValidationError (not a bare throw) when a required field is missing", async () => {
    const artifact = makeValidArtifact() as Record<string, unknown>;
    delete artifact.season; // required field, per TeamsArtifactSchema
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(artifact), { status: 200 }));

    await expect(fetchTeamsArtifact({ year: 2024, algorithmId: "vpr", version: "2.0.0+tuned-2026-08" })).rejects.toBeInstanceOf(ArtifactValidationError);
  });

  it("requests the exact key-built URL, proving artifactKey() and the origin module are wired together", async () => {
    const artifact = makeValidArtifact();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(artifact), { status: 200 }));
    global.fetch = fetchMock;

    await fetchTeamsArtifact({ year: 2024, algorithmId: "vpr", version: "2.0.0+tuned-2026-08" });

    expect(fetchMock).toHaveBeenCalledWith("https://data.sigmascout.org/v1/teams/2024/vpr@2.0.0+tuned-2026-08.json");
  });
});
