/**
 * Quick task 260929-mcf: the operator cleanup script. No test touches the network: `fetch` is stubbed
 * per URL and `r2Client` is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { artifactKey, EventsArtifactSchema, PAGE_ARTIFACT_SCHEMA_VERSION, preScheduleKey, type EventsArtifact } from "../packages/harness/pageArtifacts.js";

vi.mock("../packages/harness/r2Client.js", () => ({
  putObject: vi.fn(async () => undefined),
  deleteObject: vi.fn(async () => undefined),
}));
import { deleteObject, putObject } from "../packages/harness/r2Client.js";
import { DEFAULT_LIVE_WINDOWS_SEASONS } from "./publishLiveWindows.js";
import { cancelledArtifactKeys, main, projectEventsList, refusalReason, SEASONS } from "./pruneCancelledEvents.js";

const ALGORITHM = { id: "spr", version: "9.0.0+x" } as const;
const GENERATION = "gen-live";

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

function list(season: number, events: ReturnType<typeof row>[], generation = GENERATION): EventsArtifact {
  return EventsArtifactSchema.parse({
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation,
    computedAt: "2026-09-28T12:00:00.000Z",
    algorithmId: ALGORITHM.id,
    algorithmVersion: ALGORITHM.version,
    season,
    events,
  });
}

describe("pure helpers", () => {
  it("projectEventsList keeps the stamps and surviving rows in order, and reports the dropped keys", () => {
    const input = list(2020, [row("2020casj", "2020-03-19", 0), row("2026soon", "2026-10-03", 0), row("2026edge", "2026-09-24", 0), row("2025alhu", "2025-03-12", 96)]);
    const { artifact, droppedEventKeys } = projectEventsList(input);
    expect(droppedEventKeys).toEqual(["2020casj"]);
    expect(artifact.events.map((e) => e.eventKey)).toEqual(["2026soon", "2026edge", "2025alhu"]);
    expect({ g: artifact.generation, c: artifact.computedAt, id: artifact.algorithmId, v: artifact.algorithmVersion, s: artifact.season }).toEqual({
      g: input.generation,
      c: input.computedAt,
      id: input.algorithmId,
      v: input.algorithmVersion,
      s: input.season,
    });
    expect(EventsArtifactSchema.safeParse(artifact).success).toBe(true);
  });

  it("cancelledArtifactKeys is the event key then the presim key", () => {
    expect(cancelledArtifactKeys(["2020casj"], ALGORITHM)).toEqual([
      artifactKey({ page: "event", eventKey: "2020casj", algorithmId: "spr", version: "9.0.0+x" }),
      preScheduleKey({ eventKey: "2020casj", algorithmId: "spr", version: "9.0.0+x" }),
    ]);
  });

  it("refusalReason refuses played matches and unparseable bodies, and passes an empty matches array", () => {
    expect(refusalReason(JSON.stringify({ matches: [{ matchKey: "x" }] }))).toBeTypeOf("string");
    expect(refusalReason("not json")).toBeTypeOf("string");
    expect(refusalReason(JSON.stringify({ matches: [] }))).toBeUndefined();
  });

  it("uses the same season array object as publishLiveWindows", () => {
    expect(SEASONS).toBe(DEFAULT_LIVE_WINDOWS_SEASONS);
  });
});

describe("main", () => {
  const originalFetch = global.fetch;
  const originalExitCode = process.exitCode;

  const eventKey = (id: string) => artifactKey({ page: "event", eventKey: id, algorithmId: ALGORITHM.id, version: ALGORITHM.version });
  const presimKey = (id: string) => preScheduleKey({ eventKey: id, algorithmId: ALGORITHM.id, version: ALGORITHM.version });
  const listKey = (season: number) => artifactKey({ page: "events", year: season, algorithmId: ALGORITHM.id, version: ALGORITHM.version });

  /** url path (no origin, no query) -> body, or a bare status number */
  let routes: Map<string, string | number>;

  beforeEach(() => {
    vi.mocked(putObject).mockClear();
    vi.mocked(deleteObject).mockClear();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.exitCode = undefined;
    routes = new Map<string, string | number>([
      ["v1/manifest/algorithms.json", JSON.stringify({ generation: GENERATION, algorithms: [ALGORITHM] })],
      // 2020: a cancelled event whose artifact is a clean stub, plus a played one that stays.
      [listKey(2020), JSON.stringify(list(2020, [row("2020casj", "2020-03-19", 0), row("2020ok", "2020-03-12", 40)]))],
      [eventKey("2020casj"), JSON.stringify({ matches: [] })],
      [presimKey("2020casj"), 404],
      // 2019: written by a different generation, so it must be skipped, not rewritten.
      [listKey(2019), JSON.stringify(list(2019, [row("2019gone", "2019-03-19", 0)], "gen-other"))],
      // 2018: cancelled at the list's instant, but the live Worker has since folded a match there.
      [listKey(2018), JSON.stringify(list(2018, [row("2018fold", "2018-03-19", 0)]))],
      [eventKey("2018fold"), JSON.stringify({ matches: [{ matchKey: "2018fold_qm1" }] })],
      [presimKey("2018fold"), 404],
    ]);
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname.slice(1);
      const hit = routes.get(path);
      if (hit === undefined) return new Response("nf", { status: 404 });
      if (typeof hit === "number") return new Response("nf", { status: hit });
      return new Response(hit, { status: 200 });
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("the default run writes and deletes nothing", async () => {
    await main([]);
    expect(putObject).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("--execute rewrites lists before any delete, refuses a folded event, skips a foreign generation, and counts a 404 as absent", async () => {
    await main(["--execute"]);

    const putKeys = vi.mocked(putObject).mock.calls.map(([, key]) => key);
    // 2020 and 2018 are rewritten; 2019 (foreign generation) is not.
    expect(putKeys).toEqual([listKey(2018), listKey(2020)]);
    const deleted = vi.mocked(deleteObject).mock.calls.map(([, key]) => key);
    // The clean 2020 stub is deleted; the folded 2018 artifact is NOT, and neither is the foreign list's event.
    expect(deleted).toEqual([eventKey("2020casj")]);
    expect(deleted).not.toContain(eventKey("2018fold"));
    expect(deleted).not.toContain(eventKey("2019gone"));

    const lastPut = Math.max(...vi.mocked(putObject).mock.invocationCallOrder);
    const firstDelete = Math.min(...vi.mocked(deleteObject).mock.invocationCallOrder);
    expect(lastPut).toBeLessThan(firstDelete);

    const rewritten = JSON.parse(vi.mocked(putObject).mock.calls.find(([, key]) => key === listKey(2020))![2] as string) as EventsArtifact;
    expect(rewritten.events.map((e) => e.eventKey)).toEqual(["2020ok"]);
    expect(rewritten.generation).toBe(GENERATION);

    expect(process.exitCode).toBe(1);
  });

  it("refuses to run when the manifest does not answer 200", async () => {
    routes.set("v1/manifest/algorithms.json", 503);
    await main(["--execute"]);
    expect(putObject).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
