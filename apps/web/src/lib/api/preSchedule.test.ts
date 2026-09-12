/**
 * `fetchPreScheduleArtifact`'s own coverage (quick task 260905-tll Task 5).
 * Mirrors `apps/web/src/lib/api/event.test.ts`'s fixture discipline: build
 * an object that satisfies the REAL schema (imported from
 * `packages/harness/pageArtifacts.ts`) rather than pasting a captured
 * payload, so a schema change breaks this file loudly instead of letting a
 * stale fixture keep passing.
 *
 * The case this file exists for is the 404: an absent sidecar is an
 * ordinary, expected state for every uncovered event and every RP-less
 * algorithm, so it must resolve to `null` rather than reject — while every
 * OTHER failure still rejects, so an outage stays distinguishable from an
 * uncovered event.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PAGE_ARTIFACT_SCHEMA_VERSION,
  PublishedPreScheduleArtifactSchema,
  type PublishedPreScheduleArtifact,
} from "../../../../../packages/harness/pageArtifacts.js";
import { fetchPreScheduleArtifact, preScheduleQueryOptions, type FetchPreScheduleArtifactParams } from "./preSchedule.js";
import { ArtifactFetchError, ArtifactValidationError } from "./errors.js";

// Compile-time-only assertion, matching `event.test.ts`'s own: the params
// object has EXACTLY `eventKey`/`algorithmId`/`version` and no `year`. A
// re-introduced `year` breaks EITHER the `Exclude` (a new key) or the
// `satisfies` literal (a newly-required key), so the web typecheck fails
// loudly either way.
type ExtraParamKeys = Exclude<keyof FetchPreScheduleArtifactParams, "eventKey" | "algorithmId" | "version">;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _noExtraKeys: ExtraParamKeys extends never ? true : false = true;

const PARAMS: FetchPreScheduleArtifactParams = { eventKey: "2026casj", algorithmId: "spr", version: "9.0.0+rolling-2026-09c" };

/**
 * A minimal but genuinely schema-valid sidecar, in the PUBLISHED (post-
 * 260912-2ur) shape: three roster teams, a `scheduleCount` scalar (no
 * priced `schedules` block), and a baked block whose histograms satisfy
 * every shared refinement.
 */
function makeValidArtifact(): PublishedPreScheduleArtifact {
  return PublishedPreScheduleArtifactSchema.parse({
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-09-05T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: "9.0.0+rolling-2026-09c",
    eventKey: "2026casj",
    season: 2026,
    pricedFrom: "current-state",
    matchesPerTeam: 12,
    roster: ["frc111", "frc222", "frc333"],
    scheduleCount: 12345,
    baked: { draws: 6, histograms: [[3, 2, 1], [2, 3, 1], [1, 1, 4]] },
  });
}

/**
 * The legacy (pre-260912-2ur) shape still on every sidecar in R2 today: a
 * priced `schedules` block and no `scheduleCount`. This task's no-flag-day
 * guarantee rests on the fetch boundary still resolving this shape into a
 * real `scheduleCount` — see the dedicated test below.
 */
function makeLegacyBody(): Record<string, unknown> {
  return {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-09-05T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: "9.0.0+rolling-2026-09c",
    eventKey: "2026casj",
    season: 2026,
    pricedFrom: "current-state",
    matchesPerTeam: 12,
    roster: ["frc111", "frc222", "frc333"],
    schedules: [
      { seed: 1, matches: [{ r: [0, 1, 2], b: [2, 1, 0], rp: [0.25, 0.75], bp: [0.5, 0.5] }] },
      { seed: 2, matches: [{ r: [0, 1, 2], b: [2, 1, 0], rp: [0.25, 0.75], bp: [0.5, 0.5] }] },
      { seed: 3, matches: [{ r: [0, 1, 2], b: [2, 1, 0], rp: [0.25, 0.75], bp: [0.5, 0.5] }] },
    ],
    baked: { draws: 6, histograms: [[3, 2, 1], [2, 3, 1], [1, 1, 4]] },
  };
}

describe("fetchPreScheduleArtifact", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("parses a well-formed 200 body into the typed artifact", async () => {
    const artifact = makeValidArtifact();
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(artifact), { status: 200 }));

    const result = await fetchPreScheduleArtifact(PARAMS);

    expect(result).not.toBeNull();
    expect(result!.eventKey).toBe("2026casj");
    expect(result!.roster).toEqual(["frc111", "frc222", "frc333"]);
    expect(result!.baked.draws).toBe(6);
  });

  it("returns null on a 404 rather than throwing — an absent sidecar is an ordinary expected state, not a failure", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));

    await expect(fetchPreScheduleArtifact(PARAMS)).resolves.toBeNull();
  });

  it("resolves a legacy 200 body (schedules present, no scheduleCount) — the no-flag-day guarantee at the fetch boundary", async () => {
    const legacyBody = makeLegacyBody();
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(legacyBody), { status: 200 }));

    const result = await fetchPreScheduleArtifact(PARAMS);

    expect(result).not.toBeNull();
    expect((legacyBody.schedules as unknown[]).length).toBe(3);
    expect(result!.scheduleCount).toBe(3);
    expect((result as unknown as Record<string, unknown>).schedules).toBeUndefined();
  });

  it("still throws ArtifactFetchError on a 500 — an outage must stay distinguishable from an uncovered event", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));

    let caught: unknown;
    try {
      await fetchPreScheduleArtifact(PARAMS);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ArtifactFetchError);
    expect((caught as ArtifactFetchError).status).toBe(500);
    expect((caught as ArtifactFetchError).year).toBe(2026);
  });

  it("throws ArtifactValidationError (not a bare throw) when a 200 body fails a schema refinement", async () => {
    const artifact = makeValidArtifact() as unknown as Record<string, unknown>;
    // Break the histogram-sum refinement specifically: one count short of `draws`.
    artifact.baked = { draws: 6, histograms: [[3, 2, 0], [2, 3, 1], [1, 1, 4]] };
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(artifact), { status: 200 }));

    await expect(fetchPreScheduleArtifact(PARAMS)).rejects.toBeInstanceOf(ArtifactValidationError);
  });

  it("requests the exact preScheduleKey-built URL, proving the writer's key function and the origin module are wired together", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(makeValidArtifact()), { status: 200 }));
    global.fetch = fetchMock;

    await fetchPreScheduleArtifact(PARAMS);

    expect(fetchMock).toHaveBeenCalledWith("https://data.sigmascout.org/v1/presim/2026casj/spr@9.0.0+rolling-2026-09c.json");
  });

  it("preScheduleQueryOptions carries the positional query key eventQueryOptions' convention declares", () => {
    expect(preScheduleQueryOptions(PARAMS).queryKey).toEqual(["preSchedule", "2026casj", "spr", "9.0.0+rolling-2026-09c"]);
  });
});
