/**
 * The end of tick pass that resolves each open event's phase, logs a phase
 * change as its own ingest log row, and remembers the new phase across ticks
 * (quick task 261004-uyc).
 *
 * WHERE THE PHASE COMES FROM. A tick that fetched an event's match list holds
 * fresh `LivePhaseFacts` for it (`processEvent` derives them from the list it
 * already parsed) and the phase is derived from them. A tick that did not (every
 * poll answered 304, or the event is a probe that never promoted) holds no list,
 * so the phase stays what the stored state says. Nothing here fetches anything.
 *
 * WHERE THE PHASE IS REMEMBERED. In `event_cursor`, under the reserved key
 * `liveIngestCursorKey(eventKey)`, as a `LiveIngestState` blob (see
 * `liveIngestState.ts`). The tick reads every open window's such row in the SAME
 * statement as the roster pass's cursor read (`readOpenWindowCursors`), so
 * knowing the phase costs no extra subrequest. The row is written only when the
 * phase CHANGES: an unchanged phase writes nothing and logs nothing.
 *
 * THIS FUNCTION NEVER THROWS, for the reason `districtRefresh.ts`'s header gives:
 * its call site is upstream of `writeTickMeta`, so a throw here would cost the
 * tick its rotation offset. A failure is confined to one event, warned, and
 * recorded as a failure row with the subject `live-event-pass`.
 */
import { liveIngestCursorKey } from "../../../packages/harness/stateBaseline.js";
import type { LiveWindowEntry } from "../../../packages/harness/manifestSchemas.js";
import { deriveEventPhase } from "./eventPhase.js";
import { INGEST_LOG_PRUNE_SQL, INGEST_LOG_RETENTION_DAYS, type LiveTickContext } from "./ingestLog.js";
import { parseLiveIngestState, serializeLiveIngestState } from "./liveIngestState.js";
import { readEventCursors, writeEventCursor, type EventCursor } from "./stateStore.js";
import { sortEventKeys, type SubrequestCounter } from "./subrequestCounter.js";
import type { Env } from "./env.js";

/** D1 allows 100 bound parameters per statement; 90 keys per read leaves headroom. */
const CURSOR_READ_KEYS_PER_STATEMENT = 90;

/**
 * Every open window's cursor row AND its live ingest state row, read once for
 * the whole tick. One subrequest per statement, so one subrequest for up to 45
 * windows and one more for each further 45: the bound parameter limit, not a
 * budget, is what chunks it.
 */
export async function readOpenWindowCursors(db: Env["DB"], counter: SubrequestCounter, windows: readonly LiveWindowEntry[]): Promise<Map<string, EventCursor>> {
  const eventKeys = sortEventKeys(windows.map((w) => w.eventKey));
  const keys = [...eventKeys, ...eventKeys.map((eventKey) => liveIngestCursorKey(eventKey))];
  const merged = new Map<string, EventCursor>();
  // An empty window list still costs the one subrequest it always cost, so the
  // tick's pinned counts do not depend on whether anything is open.
  const chunkCount = Math.max(1, Math.ceil(keys.length / CURSOR_READ_KEYS_PER_STATEMENT));
  for (let i = 0; i < chunkCount; i++) {
    counter.spend(1);
    const chunk = await readEventCursors(db, keys.slice(i * CURSOR_READ_KEYS_PER_STATEMENT, (i + 1) * CURSOR_READ_KEYS_PER_STATEMENT));
    for (const [key, cursor] of chunk) merged.set(key, cursor);
  }
  return merged;
}

export interface LiveEventPassOptions {
  /** Every open window, foldable and probe alike. */
  readonly windows: readonly LiveWindowEntry[];
  /** The map `readOpenWindowCursors` returned at the top of the tick. */
  readonly cursors: ReadonlyMap<string, EventCursor>;
  readonly live: LiveTickContext;
  readonly nowIso: string;
}

export async function runLiveEventPass(env: Env, counter: SubrequestCounter, options: LiveEventPassOptions): Promise<void> {
  const { cursors, live, nowIso } = options;
  for (const eventKey of sortEventKeys(options.windows.map((w) => w.eventKey))) {
    try {
      const stateKey = liveIngestCursorKey(eventKey);
      const stored = parseLiveIngestState(cursors.get(stateKey)?.lastFoldedMatchKey);
      const facts = live.phaseFacts.get(eventKey);
      const phase = facts === undefined ? stored.phase : deriveEventPhase(facts, stored.alliancesSeen);
      live.ingest.setPhase(eventKey, phase);
      if (phase === stored.phase) continue;

      // The remembered phase is written BEFORE the row is logged: a write that
      // fails leaves the stored phase unchanged, so the next tick derives the same
      // change again and retries, and the log never holds a transition the state
      // does not.
      counter.spend(1);
      await writeEventCursor(env.DB, {
        eventKey: stateKey,
        tbaEtag: null,
        lastFoldedMatchKey: serializeLiveIngestState({ ...stored, phase }),
        lastPolledAt: nowIso,
        lastAdvancedAt: null,
        rosterEtag: null,
      });
      live.ingest.phaseChanged(eventKey, stored.phase, phase);

      if (phase === "complete") {
        const cutoff = new Date(Date.parse(nowIso) - INGEST_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
        counter.spend(1);
        await env.DB.prepare(INGEST_LOG_PRUNE_SQL).bind(cutoff).run();
      }
    } catch (error) {
      console.warn(JSON.stringify({ msg: "live-event-pass-failed", eventKey, error: (error instanceof Error ? error.message : String(error)).slice(0, 300) }));
      live.ingest.failure(eventKey, "live-event-pass", error);
    }
  }
}
