/**
 * `runLiveEventPass` and `readOpenWindowCursors` against a statement recording
 * D1 and an in memory R2 (quick task 261004-uyc): a phase change writes one phase
 * row and one reserved cursor row, a repeat writes neither, a tick with no fresh
 * match list keeps the stored phase, completion prunes, TBA's rankings are polled
 * by phase and merged into every live algorithm's event artifact, and nothing
 * here ever throws.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { IngestLogBuffer, INGEST_LOG_PRUNE_SQL, type LiveTickContext } from "../src/ingestLog.js";
import { readOpenWindowCursors, runLiveEventPass, type LiveEventPassOptions, type PassAlgorithmContext } from "../src/liveEventPass.js";
import { serializeLiveIngestState, parseLiveIngestState, DEFAULT_LIVE_INGEST_STATE, type LiveIngestState } from "../src/liveIngestState.js";
import { SubrequestCounter } from "../src/subrequestCounter.js";
import { createTbaContext, TbaRequestCounter } from "../src/tbaPoll.js";
import type { EventCursor } from "../src/stateStore.js";
import type { LivePhaseFacts } from "../src/eventPhase.js";
import { artifactKey, EventArtifactSchema, PAGE_ARTIFACT_SCHEMA_VERSION, type EventArtifact } from "../../../packages/harness/pageArtifacts.js";
import type { LiveWindowEntry } from "../../../packages/harness/manifestSchemas.js";
import type { Env } from "../src/env.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const NOW_ISO = "2026-10-03T23:00:00.000Z";
const STAMP = { generation: "tick-1", computedAt: NOW_ISO };
const TEAMS = ["frc1", "frc2", "frc3", "frc4"];
const LAST_MODIFIED = "Sat, 03 Oct 2026 22:55:19 GMT";

interface Recorded {
  readonly sql: string;
  readonly args: readonly unknown[];
}

/** An in memory R2 bucket: counts reads and puts, and `get`s what was `put` or seeded. */
class FakeArtifacts {
  readonly store = new Map<string, string>();
  gets = 0;
  puts: { key: string; body: string }[] = [];
  async get(key: string): Promise<{ text(): Promise<string> } | null> {
    this.gets++;
    const value = this.store.get(key);
    return value === undefined ? null : { text: async () => value };
  }
  async put(key: string, body: string): Promise<void> {
    this.puts.push({ key, body });
    this.store.set(key, body);
  }
}

function recordingEnv(): { env: Env; writes: Recorded[]; reject: { error: Error | null }; artifacts: FakeArtifacts } {
  const writes: Recorded[] = [];
  const reject: { error: Error | null } = { error: null };
  const artifacts = new FakeArtifacts();
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        run: async () => {
          if (reject.error !== null) throw reject.error;
          writes.push({ sql, args });
          return { success: true, meta: { changes: 1 } };
        },
        all: async () => ({ results: [] }),
      }),
    }),
  };
  return { env: { DB: db, ARTIFACTS: artifacts, TBA_API_KEY: "test-key", TBA_BASE_URL: "https://tba.example.invalid/api/v3" } as unknown as Env, writes, reject, artifacts };
}

function windowOf(eventKey: string): LiveWindowEntry {
  return { eventKey, season: 2026, startMs: 0, endMs: 1, inferred: false } as LiveWindowEntry;
}

function context(): LiveTickContext {
  return { ingest: new IngestLogBuffer(NOW_ISO), phaseFacts: new Map() };
}

const IN_PROGRESS: LivePhaseFacts = { qualTotal: 10, qualPlayed: 4, playoffTotal: 0, playoffPlayed: 0, playoffWithBothAlliances: 0, finalsDecided: false };
const FINISHED: LivePhaseFacts = { qualTotal: 10, qualPlayed: 10, playoffTotal: 3, playoffPlayed: 3, playoffWithBothAlliances: 3, finalsDecided: true };

function storedState(eventKey: string, state: Partial<LiveIngestState>): Map<string, EventCursor> {
  return new Map([
    [
      `__live_ingest__:${eventKey}`,
      { eventKey: `__live_ingest__:${eventKey}`, tbaEtag: null, lastFoldedMatchKey: serializeLiveIngestState({ ...DEFAULT_LIVE_INGEST_STATE, ...state }), lastPolledAt: null, lastAdvancedAt: null, rosterEtag: null },
    ],
  ]);
}

/** The state blob the pass last wrote for the event, as the next tick's cursor map. */
function cursorsAfter(writes: readonly Recorded[], eventKey: string): Map<string, EventCursor> {
  const key = `__live_ingest__:${eventKey}`;
  const last = [...writes].reverse().find((write) => write.args[0] === key);
  if (last === undefined) return new Map();
  return new Map([[key, { eventKey: key, tbaEtag: null, lastFoldedMatchKey: String(last.args[2]), lastPolledAt: null, lastAdvancedAt: null, rosterEtag: null }]]);
}

function lastState(writes: readonly Recorded[], eventKey: string): LiveIngestState {
  return parseLiveIngestState(cursorsAfter(writes, eventKey).get(`__live_ingest__:${eventKey}`)?.lastFoldedMatchKey);
}

// ---------------------------------------------------------------------------
// TBA stub and artifact fixtures
// ---------------------------------------------------------------------------

function rankingsBody(teamKeys: readonly string[], sortName = "Ranking Score"): unknown {
  return {
    rankings: teamKeys.map((teamKey, i) => ({
      team_key: teamKey,
      rank: i + 1,
      matches_played: 5,
      dq: 0,
      qual_average: null,
      sort_orders: [3.43 - i * 0.1234, 1, 2],
      extra_stats: [],
      record: { wins: 5 - i, losses: i, ties: 0 },
    })),
    sort_order_info: [{ name: sortName, precision: 2 }],
    extra_stats_info: [],
  };
}

interface EndpointAnswer {
  /** The ETag a 200 carries and the one a request must send to get a 304. */
  readonly etag?: string;
  readonly body: unknown;
}

/** Stubs `fetch` for the two official endpoints. Records every request's URL and If-None-Match. */
function stubTba(answers: { rankings?: EndpointAnswer; alliances?: EndpointAnswer }, calls: { url: string; ifNoneMatch: string | undefined }[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { headers?: Record<string, string> }) => {
      const u = String(url);
      const ifNoneMatch = init?.headers?.["If-None-Match"];
      calls.push({ url: u, ifNoneMatch });
      const kind = /\/event\/[^/]+\/(rankings|alliances)$/.exec(u)?.[1] as "rankings" | "alliances" | undefined;
      if (kind === undefined) throw new Error(`unexpected URL ${u}`);
      const answer = answers[kind];
      if (answer === undefined) return { status: 404, ok: false, headers: new Map(), json: async () => ({}) };
      if (answer.etag !== undefined && ifNoneMatch === answer.etag) return { status: 304, ok: false, headers: new Map(), json: async () => ({}) };
      return {
        status: 200,
        ok: true,
        headers: { get: (name: string) => (name === "etag" ? (answer.etag ?? null) : name === "last-modified" ? LAST_MODIFIED : null) },
        json: async () => answer.body,
      };
    })
  );
  return calls;
}

function eventArtifactFor(eventKey: string, algorithmId: string, version: string, overrides: Record<string, unknown> = {}): EventArtifact {
  return EventArtifactSchema.parse({
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "before",
    computedAt: "2026-10-03T22:00:00.000Z",
    algorithmId,
    algorithmVersion: version,
    eventKey,
    season: 2026,
    matches: [],
    upcoming: [],
    teams: TEAMS.map((teamKey, i) => ({ teamKey, teamNumber: i + 1, nickname: `Team ${i + 1}`, metrics: {} })),
    ...overrides,
  });
}

const MODULES: PassAlgorithmContext["modules"] = new Map([
  ["spr", { version: "9.0.0+test" }],
  ["opr", { version: "5.0.0+test" }],
]);

function keyFor(eventKey: string, algorithmId: string): string {
  return artifactKey({ page: "event", eventKey, algorithmId, version: MODULES.get(algorithmId)!.version });
}

function seedAll(artifacts: FakeArtifacts, eventKey: string, overrides: Record<string, unknown> = {}): void {
  for (const [algorithmId, { version }] of MODULES) artifacts.store.set(keyFor(eventKey, algorithmId), JSON.stringify(eventArtifactFor(eventKey, algorithmId, version, overrides)));
}

interface PassRun {
  readonly counter: SubrequestCounter;
  readonly live: LiveTickContext;
  readonly result: Awaited<ReturnType<typeof runLiveEventPass>>;
}

async function runPass(env: Env, options: Partial<LiveEventPassOptions> & { windows: readonly LiveWindowEntry[]; mismatch?: unknown }): Promise<PassRun> {
  const counter = new SubrequestCounter();
  const live = options.live ?? context();
  const { mismatch, ...rest } = options;
  const algorithmContext = async (): Promise<PassAlgorithmContext> => ({ modules: MODULES, mismatch });
  const result = await runLiveEventPass(env, counter, {
    cursors: new Map(),
    nowIso: NOW_ISO,
    tbaCtx: createTbaContext(env, new TbaRequestCounter()),
    algorithmContext,
    stamp: STAMP,
    ...rest,
    live,
  });
  return { counter, live, result };
}

describe("runLiveEventPass", () => {
  it("a tick whose match list derives a new phase writes one phase row and one reserved cursor row", async () => {
    const { env, writes } = recordingEnv();
    stubTba({});
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const live = context();
    live.phaseFacts.set("2026vari", IN_PROGRESS);

    const { counter } = await runPass(env, { windows: [windowOf("2026vari")], live });

    // The rankings request answers 404 here (nothing configured), which is a
    // failed poll, not a write: the state write and the phase row are what this
    // case is about.
    expect(writes).toHaveLength(1);
    expect(writes[0]!.args[0]).toBe("__live_ingest__:2026vari");
    expect(JSON.parse(String(writes[0]!.args[2]))).toMatchObject({ phase: "quals-in-progress" });
    expect(writes[0]!.args[3]).toBe(NOW_ISO);
    const phaseRows = live.ingest.rows().filter((row) => row.kind === "phase");
    expect(phaseRows).toHaveLength(1);
    expect(phaseRows[0]).toMatchObject({ eventKey: "2026vari", subject: "quals-in-progress", detail: '{"from":"no-schedule"}' });
    // One rankings request plus the cursor write.
    expect(counter.used).toBe(2);
  });

  it("the next tick deriving the same phase writes neither, but still stamps the phase on the event's rows", async () => {
    const { env, writes } = recordingEnv();
    stubTba({ rankings: { body: null } });
    const live = context();
    live.phaseFacts.set("2026vari", IN_PROGRESS);
    live.ingest.endpointChanged("2026vari", "matches");

    await runPass(env, { windows: [windowOf("2026vari")], cursors: storedState("2026vari", { phase: "quals-in-progress" }), live });

    expect(writes).toHaveLength(0);
    expect(live.ingest.rows().filter((row) => row.kind === "phase")).toHaveLength(0);
    expect(live.ingest.rows()[0]!.phase).toBe("quals-in-progress");
  });

  it("a tick with no fresh match list for an event whose stored phase wants nothing keeps the stored phase and costs nothing", async () => {
    const { env, writes } = recordingEnv();
    const fetchCalls = stubTba({});
    const live = context();

    const { counter } = await runPass(env, { windows: [windowOf("2026vari")], cursors: storedState("2026vari", { phase: "schedule-posted" }), live });

    expect(writes).toHaveLength(0);
    expect(live.ingest.rows()).toHaveLength(0);
    expect(counter.used).toBe(0);
    expect(fetchCalls).toHaveLength(0);
  });

  it("a transition to complete also issues the retention prune, bound to now minus 60 days", async () => {
    const { env, writes } = recordingEnv();
    stubTba({ rankings: { body: null }, alliances: { body: null } });
    const live = context();
    live.phaseFacts.set("2026vari", FINISHED);

    await runPass(env, { windows: [windowOf("2026vari")], cursors: storedState("2026vari", { phase: "playoffs-in-progress" }), live });

    expect(writes).toHaveLength(2);
    expect(writes[1]!.sql).toBe(INGEST_LOG_PRUNE_SQL);
    expect(writes[1]!.args).toEqual(["2026-08-04T23:00:00.000Z"]);
  });

  it("a rejecting D1 write is caught, logged as a failure row with subject live-event-pass, and the pass never throws", async () => {
    const { env, reject } = recordingEnv();
    reject.error = new Error("D1_ERROR: database is locked");
    stubTba({});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const live = context();
    live.phaseFacts.set("2026vari", IN_PROGRESS);

    await expect(runPass(env, { windows: [windowOf("2026vari")], live })).resolves.toBeDefined();

    const failures = live.ingest.rows().filter((row) => row.kind === "failure" && row.subject === "live-event-pass");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ eventKey: "2026vari" });
    // The state write failed, so no transition was logged: the next tick retries it.
    expect(live.ingest.rows().filter((row) => row.kind === "phase")).toHaveLength(0);
    // The rankings poll failed too (404): one warn line for it, one for the pass.
    expect(warn.mock.calls.map((call) => (JSON.parse(String(call[0])) as { msg: string }).msg).sort()).toEqual(["live-event-pass-failed", "official-data-failed"]);
  });

  it("one event's failure does not stop the next event's pass", async () => {
    const writes: string[] = [];
    let first = true;
    const db = {
      prepare: () => ({
        bind: (...args: unknown[]) => ({
          run: async () => {
            if (first) {
              first = false;
              throw new Error("boom");
            }
            writes.push(String(args[0]));
            return { success: true };
          },
        }),
      }),
    };
    stubTba({ rankings: { body: null } });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const live = context();
    live.phaseFacts.set("2026aaaa", IN_PROGRESS);
    live.phaseFacts.set("2026bbbb", IN_PROGRESS);
    const env = { DB: db, ARTIFACTS: new FakeArtifacts(), TBA_API_KEY: "k", TBA_BASE_URL: "https://tba.example.invalid/api/v3" } as unknown as Env;

    await runPass(env, { windows: [windowOf("2026bbbb"), windowOf("2026aaaa")], live });

    // The null body leaves the state unchanged except the phase and the ETag
    // (none sent), so the phase write is the only one; the first event's write
    // throws and the second event's still happens.
    expect(writes).toEqual(["__live_ingest__:2026bbbb"]);
  });
});

describe("runLiveEventPass: TBA's rankings", () => {
  const EVENT = "2026vari";

  it("quals in progress and a 200 with ranked teams writes one artifact per live algorithm, stores the ETag and rankingsSeen, and logs one endpoint row", async () => {
    const { env, writes, artifacts } = recordingEnv();
    seedAll(artifacts, EVENT, { standings: { source: "tick-counted", ranked: true } });
    stubTba({ rankings: { etag: "rank-1", body: rankingsBody(["frc3", "frc1", "frc2"]) } });
    const live = context();
    live.phaseFacts.set(EVENT, IN_PROGRESS);

    const { result } = await runPass(env, { windows: [windowOf(EVENT)], live });

    expect(result).toEqual({ officialDataPolled: 1, officialDataWritten: 2 });
    expect(artifacts.puts.map((put) => put.key).sort()).toEqual([keyFor(EVENT, "opr"), keyFor(EVENT, "spr")].sort());
    for (const put of artifacts.puts) {
      const written = JSON.parse(put.body) as EventArtifact;
      expect(written).not.toHaveProperty("standings");
      expect(written.generation).toBe("tick-1");
      expect(written.computedAt).toBe(NOW_ISO);
      expect(written.teams.map((row) => [row.teamKey, row.rank, row.record, row.rp])).toEqual([
        ["frc1", 2, { wins: 4, losses: 1, ties: 0 }, 3.31],
        ["frc2", 3, { wins: 3, losses: 2, ties: 0 }, 3.18],
        ["frc3", 1, { wins: 5, losses: 0, ties: 0 }, 3.43],
        ["frc4", undefined, undefined, undefined],
      ]);
    }
    const state = lastState(writes, EVENT);
    expect(state).toMatchObject({ rankingsEtag: "rank-1", rankingsSeen: true, rankingsChangedAt: NOW_ISO });
    const endpointRows = live.ingest.rows().filter((row) => row.kind === "endpoint");
    expect(endpointRows).toHaveLength(1);
    expect(endpointRows[0]).toMatchObject({ eventKey: EVENT, subject: "rankings", tbaLastModified: LAST_MODIFIED, detail: '{"rankedTeams":3}' });
    expect(endpointRows[0]!.publishedAt).not.toBeNull();
  });

  it("the next tick sends If-None-Match, gets 304, writes nothing and logs nothing", async () => {
    const first = recordingEnv();
    seedAll(first.artifacts, EVENT);
    const calls = stubTba({ rankings: { etag: "rank-1", body: rankingsBody(["frc1", "frc2"]) } });
    const live1 = context();
    live1.phaseFacts.set(EVENT, IN_PROGRESS);
    await runPass(first.env, { windows: [windowOf(EVENT)], live: live1 });
    const putsAfterFirst = first.artifacts.puts.length;
    const writesAfterFirst = first.writes.length;

    const live2 = context();
    const { result, counter } = await runPass(first.env, { windows: [windowOf(EVENT)], cursors: cursorsAfter(first.writes, EVENT), live: live2 });

    expect(calls.at(-1)).toMatchObject({ ifNoneMatch: "rank-1" });
    expect(result).toEqual({ officialDataPolled: 1, officialDataWritten: 0 });
    expect(first.artifacts.puts).toHaveLength(putsAfterFirst);
    expect(first.writes).toHaveLength(writesAfterFirst);
    expect(live2.ingest.rows()).toHaveLength(0);
    // The request is the whole cost: no artifact read, no write.
    expect(counter.used).toBe(1);
  });

  it("phase schedule-posted makes no rankings request at all", async () => {
    const { env } = recordingEnv();
    const calls = stubTba({ rankings: { body: rankingsBody(["frc1"]) } });
    const live = context();
    live.phaseFacts.set(EVENT, { ...IN_PROGRESS, qualPlayed: 0 });

    const { result } = await runPass(env, { windows: [windowOf(EVENT)], live });

    expect(calls).toHaveLength(0);
    expect(result).toEqual({ officialDataPolled: 0, officialDataWritten: 0 });
  });

  it.each([
    ["a null body", null],
    ["an empty rankings array", { rankings: [], sort_order_info: [], extra_stats_info: [] }],
  ])("a 200 with %s stores the ETag, writes no artifact and leaves rankingsSeen false", async (_name, body) => {
    const { env, writes, artifacts } = recordingEnv();
    seedAll(artifacts, EVENT);
    stubTba({ rankings: { etag: "empty-1", body } });
    const live = context();
    live.phaseFacts.set(EVENT, IN_PROGRESS);

    const { result } = await runPass(env, { windows: [windowOf(EVENT)], live });

    expect(artifacts.puts).toHaveLength(0);
    expect(artifacts.gets).toBe(0);
    expect(result.officialDataWritten).toBe(0);
    expect(lastState(writes, EVENT)).toMatchObject({ rankingsEtag: "empty-1", rankingsSeen: false });
    expect(live.ingest.rows().filter((row) => row.kind === "endpoint")).toHaveLength(0);
  });

  it("a 200 whose sort_order_info does not lead with Ranking Score writes nothing, stores no ETag and logs a failure row with subject rankings", async () => {
    const { env, writes, artifacts } = recordingEnv();
    seedAll(artifacts, EVENT);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    stubTba({ rankings: { etag: "drift-1", body: rankingsBody(["frc1", "frc2"], "Avg Tower") } });
    const live = context();
    live.phaseFacts.set(EVENT, IN_PROGRESS);

    await runPass(env, { windows: [windowOf(EVENT)], live });

    expect(artifacts.puts).toHaveLength(0);
    expect(lastState(writes, EVENT).rankingsEtag).toBeNull();
    const failures = live.ingest.rows().filter((row) => row.kind === "failure");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ subject: "rankings", eventKey: EVENT });
    expect(JSON.parse(String(warn.mock.calls[0]![0]))).toMatchObject({ msg: "official-data-failed", endpoint: "rankings", eventKey: EVENT });
    expect(String(warn.mock.calls[0]![0])).not.toContain("test-key");
  });

  it("a live algorithm with no event artifact yet is skipped and the ETag is NOT stored; the retry writes only what differs and logs only a write", async () => {
    const { env, writes, artifacts } = recordingEnv();
    // Only spr has an artifact; opr has none yet.
    artifacts.store.set(keyFor(EVENT, "spr"), JSON.stringify(eventArtifactFor(EVENT, "spr", MODULES.get("spr")!.version)));
    stubTba({ rankings: { etag: "rank-1", body: rankingsBody(["frc1", "frc2"]) } });
    const live1 = context();
    live1.phaseFacts.set(EVENT, IN_PROGRESS);

    const first = await runPass(env, { windows: [windowOf(EVENT)], live: live1 });

    expect(first.result.officialDataWritten).toBe(1);
    expect(lastState(writes, EVENT).rankingsEtag).toBeNull();
    expect(lastState(writes, EVENT).rankingsSeen).toBe(false);

    // opr's artifact now exists (the fold wrote it); the next tick asks again, with no ETag.
    artifacts.store.set(keyFor(EVENT, "opr"), JSON.stringify(eventArtifactFor(EVENT, "opr", MODULES.get("opr")!.version)));
    const putsBefore = artifacts.puts.length;
    const live2 = context();
    const second = await runPass(env, { windows: [windowOf(EVENT)], cursors: cursorsAfter(writes, EVENT), live: live2 });

    expect(second.result.officialDataWritten).toBe(1);
    expect(artifacts.puts.slice(putsBefore).map((put) => put.key)).toEqual([keyFor(EVENT, "opr")]);
    expect(lastState(writes, EVENT)).toMatchObject({ rankingsEtag: "rank-1", rankingsSeen: true });
    expect(live2.ingest.rows().filter((row) => row.kind === "endpoint")).toHaveLength(1);

    // A third tick, TBA unchanged, sends the stored ETag and gets 304.
    const live3 = context();
    const third = await runPass(env, { windows: [windowOf(EVENT)], cursors: cursorsAfter(writes, EVENT), live: live3 });
    expect(third.result.officialDataWritten).toBe(0);
    expect(live3.ingest.rows()).toHaveLength(0);
  });

  it("a retry whose artifacts already carry the ranks writes nothing and logs no endpoint row", async () => {
    const { env, writes, artifacts } = recordingEnv();
    seedAll(artifacts, EVENT);
    stubTba({ rankings: { etag: "rank-1", body: rankingsBody(["frc1", "frc2"]) } });
    const live1 = context();
    live1.phaseFacts.set(EVENT, IN_PROGRESS);
    await runPass(env, { windows: [windowOf(EVENT)], live: live1 });
    // The ETag was lost (a failed state write, say): the next tick polls without one.
    const putsBefore = artifacts.puts.length;
    const live2 = context();

    const second = await runPass(env, { windows: [windowOf(EVENT)], cursors: storedState(EVENT, { phase: "quals-in-progress" }), live: live2 });

    expect(second.result).toEqual({ officialDataPolled: 1, officialDataWritten: 0 });
    expect(artifacts.puts).toHaveLength(putsBefore);
    expect(live2.ingest.rows().filter((row) => row.kind === "endpoint")).toHaveLength(0);
    expect(lastState(writes, EVENT).rankingsEtag).toBe("rank-1");
  });

  it("a state generation mismatch writes nothing and stores no ETag", async () => {
    const { env, writes, artifacts } = recordingEnv();
    seedAll(artifacts, EVENT);
    stubTba({ rankings: { etag: "rank-1", body: rankingsBody(["frc1"]) } });
    const live = context();
    live.phaseFacts.set(EVENT, IN_PROGRESS);

    const { result } = await runPass(env, { windows: [windowOf(EVENT)], live, mismatch: { manifestGeneration: "g" } });

    expect(artifacts.puts).toHaveLength(0);
    expect(artifacts.gets).toBe(0);
    expect(result.officialDataWritten).toBe(0);
    expect(lastState(writes, EVENT).rankingsEtag).toBeNull();
  });

  it("an event in a probe window whose matches poll answered 304 this tick is still polled for rankings from its stored phase", async () => {
    const { env, artifacts } = recordingEnv();
    seedAll(artifacts, EVENT);
    const calls = stubTba({ rankings: { etag: "rank-1", body: rankingsBody(["frc1", "frc2"]) } });
    const live = context(); // no phase facts: this tick held no match list for the event

    const { result } = await runPass(env, {
      windows: [{ ...windowOf(EVENT), inferred: true }],
      cursors: storedState(EVENT, { phase: "quals-in-progress" }),
      live,
    });

    expect(calls).toHaveLength(1);
    expect(result.officialDataWritten).toBe(2);
  });

  it("a throwing poll for one event does not stop the next event's poll", async () => {
    const { env, artifacts } = recordingEnv();
    seedAll(artifacts, "2026bbbb");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        if (String(url).includes("2026aaaa")) return { status: 500, ok: false, headers: new Map(), json: async () => ({}) };
        return { status: 200, ok: true, headers: { get: () => null }, json: async () => rankingsBody(["frc1", "frc2"]) };
      })
    );
    const live = context();
    live.phaseFacts.set("2026aaaa", IN_PROGRESS);
    live.phaseFacts.set("2026bbbb", IN_PROGRESS);

    const { result } = await runPass(env, { windows: [windowOf("2026aaaa"), windowOf("2026bbbb")], live });

    expect(result.officialDataWritten).toBe(2);
    expect(live.ingest.rows().filter((row) => row.kind === "failure").map((row) => [row.eventKey, row.subject])).toEqual([["2026aaaa", "rankings"]]);
  });
});

describe("readOpenWindowCursors", () => {
  it("reads every window's cursor and live ingest row in ONE statement and ONE subrequest", async () => {
    const statements: { sql: string; args: readonly unknown[] }[] = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          all: async () => {
            statements.push({ sql, args });
            return { results: [] };
          },
        }),
      }),
    };
    const counter = new SubrequestCounter();

    await readOpenWindowCursors(db as unknown as Env["DB"], counter, [windowOf("2026bbbb"), windowOf("2026aaaa")]);

    expect(statements).toHaveLength(1);
    expect(statements[0]!.args).toEqual(["2026aaaa", "2026bbbb", "__live_ingest__:2026aaaa", "__live_ingest__:2026bbbb"]);
    expect(counter.used).toBe(1);
  });

  it("chunks under D1's 100 parameter limit when there are more than 45 windows", async () => {
    const sizes: number[] = [];
    const db = {
      prepare: () => ({
        bind: (...args: unknown[]) => ({
          all: async () => {
            sizes.push(args.length);
            return { results: [] };
          },
        }),
      }),
    };
    const windows = Array.from({ length: 60 }, (_, i) => windowOf(`2026e${String(i).padStart(3, "0")}`));
    const counter = new SubrequestCounter();

    await readOpenWindowCursors(db as unknown as Env["DB"], counter, windows);

    expect(sizes).toEqual([90, 30]);
    expect(counter.used).toBe(2);
  });
});
