/**
 * `runLiveEventPass` and `readOpenWindowCursors` against a statement recording
 * D1 (quick task 261004-uyc): a phase change writes one phase row and one
 * reserved cursor row, a repeat writes neither, a tick with no fresh match list
 * keeps the stored phase, completion prunes, and nothing here ever throws.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { IngestLogBuffer, INGEST_LOG_PRUNE_SQL, type LiveTickContext } from "../src/ingestLog.js";
import { readOpenWindowCursors, runLiveEventPass } from "../src/liveEventPass.js";
import { serializeLiveIngestState, DEFAULT_LIVE_INGEST_STATE } from "../src/liveIngestState.js";
import { SubrequestCounter } from "../src/subrequestCounter.js";
import type { EventCursor } from "../src/stateStore.js";
import type { LivePhaseFacts } from "../src/eventPhase.js";
import type { LiveWindowEntry } from "../../../packages/harness/manifestSchemas.js";
import type { Env } from "../src/env.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const NOW_ISO = "2026-10-03T23:00:00.000Z";

interface Recorded {
  readonly sql: string;
  readonly args: readonly unknown[];
}

function recordingEnv(): { env: Env; writes: Recorded[]; reject: { error: Error | null } } {
  const writes: Recorded[] = [];
  const reject: { error: Error | null } = { error: null };
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
  return { env: { DB: db } as unknown as Env, writes, reject };
}

function windowOf(eventKey: string): LiveWindowEntry {
  return { eventKey, season: 2026, startMs: 0, endMs: 1, inferred: false } as LiveWindowEntry;
}

function context(): LiveTickContext {
  return { ingest: new IngestLogBuffer(NOW_ISO), phaseFacts: new Map() };
}

const IN_PROGRESS: LivePhaseFacts = { qualTotal: 10, qualPlayed: 4, playoffTotal: 0, playoffPlayed: 0, playoffWithBothAlliances: 0, finalsDecided: false };
const FINISHED: LivePhaseFacts = { qualTotal: 10, qualPlayed: 10, playoffTotal: 3, playoffPlayed: 3, playoffWithBothAlliances: 3, finalsDecided: true };

function storedState(eventKey: string, phase: Parameters<typeof serializeLiveIngestState>[0]["phase"]): Map<string, EventCursor> {
  return new Map([
    [
      `__live_ingest__:${eventKey}`,
      { eventKey: `__live_ingest__:${eventKey}`, tbaEtag: null, lastFoldedMatchKey: serializeLiveIngestState({ ...DEFAULT_LIVE_INGEST_STATE, phase }), lastPolledAt: null, lastAdvancedAt: null, rosterEtag: null },
    ],
  ]);
}

describe("runLiveEventPass", () => {
  it("a tick whose match list derives a new phase writes one phase row and one reserved cursor row", async () => {
    const { env, writes } = recordingEnv();
    const live = context();
    live.phaseFacts.set("2026vari", IN_PROGRESS);
    const counter = new SubrequestCounter();

    await runLiveEventPass(env, counter, { windows: [windowOf("2026vari")], cursors: new Map(), live, nowIso: NOW_ISO });

    expect(writes).toHaveLength(1);
    expect(writes[0]!.args[0]).toBe("__live_ingest__:2026vari");
    expect(JSON.parse(String(writes[0]!.args[2]))).toMatchObject({ phase: "quals-in-progress" });
    expect(writes[0]!.args[3]).toBe(NOW_ISO);
    const phaseRows = live.ingest.rows().filter((row) => row.kind === "phase");
    expect(phaseRows).toHaveLength(1);
    expect(phaseRows[0]).toMatchObject({ eventKey: "2026vari", subject: "quals-in-progress", detail: '{"from":"no-schedule"}' });
    expect(counter.used).toBe(1);
  });

  it("the next tick deriving the same phase writes neither, but still stamps the phase on the event's rows", async () => {
    const { env, writes } = recordingEnv();
    const live = context();
    live.phaseFacts.set("2026vari", IN_PROGRESS);
    live.ingest.endpointChanged("2026vari", "matches");

    await runLiveEventPass(env, new SubrequestCounter(), { windows: [windowOf("2026vari")], cursors: storedState("2026vari", "quals-in-progress"), live, nowIso: NOW_ISO });

    expect(writes).toHaveLength(0);
    expect(live.ingest.rows().filter((row) => row.kind === "phase")).toHaveLength(0);
    expect(live.ingest.rows()[0]!.phase).toBe("quals-in-progress");
  });

  it("a tick with no fresh match list for an event keeps the stored phase and writes nothing", async () => {
    const { env, writes } = recordingEnv();
    const live = context();
    const counter = new SubrequestCounter();

    await runLiveEventPass(env, counter, { windows: [windowOf("2026vari")], cursors: storedState("2026vari", "alliances-posted"), live, nowIso: NOW_ISO });

    expect(writes).toHaveLength(0);
    expect(live.ingest.rows()).toHaveLength(0);
    expect(counter.used).toBe(0);
  });

  it("a transition to complete also issues the retention prune, bound to now minus 60 days", async () => {
    const { env, writes } = recordingEnv();
    const live = context();
    live.phaseFacts.set("2026vari", FINISHED);

    await runLiveEventPass(env, new SubrequestCounter(), { windows: [windowOf("2026vari")], cursors: storedState("2026vari", "playoffs-in-progress"), live, nowIso: NOW_ISO });

    expect(writes).toHaveLength(2);
    expect(writes[1]!.sql).toBe(INGEST_LOG_PRUNE_SQL);
    expect(writes[1]!.args).toEqual(["2026-08-04T23:00:00.000Z"]);
  });

  it("a rejecting D1 write is caught, logged as a failure row with subject live-event-pass, and the pass never throws", async () => {
    const { env, reject } = recordingEnv();
    reject.error = new Error("D1_ERROR: database is locked");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const live = context();
    live.phaseFacts.set("2026vari", IN_PROGRESS);

    await expect(runLiveEventPass(env, new SubrequestCounter(), { windows: [windowOf("2026vari")], cursors: new Map(), live, nowIso: NOW_ISO })).resolves.toBeUndefined();

    const failures = live.ingest.rows().filter((row) => row.kind === "failure");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ subject: "live-event-pass", eventKey: "2026vari" });
    // The state write failed, so no transition was logged: the next tick retries it.
    expect(live.ingest.rows().filter((row) => row.kind === "phase")).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
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
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const live = context();
    live.phaseFacts.set("2026aaaa", IN_PROGRESS);
    live.phaseFacts.set("2026bbbb", IN_PROGRESS);

    await runLiveEventPass({ DB: db } as unknown as Env, new SubrequestCounter(), { windows: [windowOf("2026bbbb"), windowOf("2026aaaa")], cursors: new Map(), live, nowIso: NOW_ISO });

    expect(writes).toEqual(["__live_ingest__:2026bbbb"]);
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
