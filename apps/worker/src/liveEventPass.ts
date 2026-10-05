/**
 * The end of tick pass that resolves each open event's phase, polls TBA's own
 * rankings and alliances for it by that phase, writes them onto every live
 * algorithm's event artifact, logs what changed, and remembers the phase and the
 * two ETags across ticks (quick task 261004-uyc).
 *
 * WHERE THE PHASE COMES FROM. A tick that fetched an event's match list holds
 * fresh `LivePhaseFacts` for it (`processEvent` derives them from the list it
 * already parsed) and the phase is derived from them. A tick that did not (every
 * poll answered 304, or the event is a probe that never promoted) holds no list,
 * so the phase stays what the stored state says, and the official data polls run
 * from that stored phase. That is what lets an alliance selection be picked up
 * while no match is being played.
 *
 * WHICH ENDPOINTS, AND WHAT BECOMES OF THEM. `eventPhase.ts`'s `endpointsToPoll`
 * decides which of `/event/{key}/rankings` and `/event/{key}/alliances` a tick
 * asks about. Each is a conditional GET (the ETag lives in the state blob), so an
 * unchanged answer is a 304 that writes and logs nothing. A 200 is parsed at this
 * boundary, normalized by the offline ingest's own rules
 * (`normalizeEventRankings` refuses a Ranking Score vocabulary it does not
 * recognise), and merged by `officialStandings.ts` into the event artifact of
 * EVERY live algorithm, in one read and at most one write per algorithm however
 * many endpoints changed. An algorithm with no event artifact yet is skipped and
 * the ETag is NOT stored, so the next tick asks again and writes what is by then
 * missing; the retry writes only artifacts that differ from what is already
 * there. A state generation mismatch suspends the write exactly as it suspends
 * every other live write, and stores no ETag either.
 *
 * WHERE THE STATE IS REMEMBERED. In `event_cursor`, under the reserved key
 * `liveIngestCursorKey(eventKey)`, as a `LiveIngestState` blob (see
 * `liveIngestState.ts`). The tick reads every open window's such row in the SAME
 * statement as the roster pass's cursor read (`readOpenWindowCursors`), so
 * knowing the state costs no extra subrequest. The row is written only when the
 * serialised state CHANGES, once per event per tick.
 *
 * THIS FUNCTION NEVER THROWS, for the reason `districtRefresh.ts`'s header gives:
 * its call site is upstream of `writeTickMeta`, so a throw here would cost the
 * tick its rotation offset. A failing endpoint is confined to that endpoint of
 * that event, warned as `official-data-failed`, and recorded as a failure row
 * whose subject is the endpoint; anything else is confined to one event, warned,
 * and recorded as a failure row with the subject `live-event-pass`.
 */
import { liveIngestCursorKey } from "../../../packages/harness/stateBaseline.js";
import type { LiveWindowEntry } from "../../../packages/harness/manifestSchemas.js";
import { artifactKey, type EventArtifact } from "../../../packages/harness/pageArtifacts.js";
import { normalizeEventAlliances } from "../../../packages/ingest/alliances.js";
import { normalizeEventRankings } from "../../../packages/ingest/rankings.js";
import { tbaAllianceResponseSchema, tbaEventRankingsResponseSchema } from "../../../packages/ingest/schemas.js";
import { checkLiveEventArtifactShape } from "./artifactShapeCheck.js";
import { readArtifactObject, writeArtifactObject } from "./artifactWriter.js";
import type { Stamp } from "./artifactMerge.js";
import { deriveEventPhase, endpointsToPoll, type EventPhase } from "./eventPhase.js";
import { INGEST_LOG_PRUNE_SQL, INGEST_LOG_RETENTION_DAYS, type LiveTickContext } from "./ingestLog.js";
import { parseLiveIngestState, serializeLiveIngestState, type LiveIngestState } from "./liveIngestState.js";
import { applyOfficialAlliances, applyOfficialRankings } from "./officialStandings.js";
import { readEventCursors, writeEventCursor, type EventCursor } from "./stateStore.js";
import { sortEventKeys, type SubrequestCounter } from "./subrequestCounter.js";
import { pollEventAlliances, pollEventRankings, type TbaClientContext } from "./tbaPoll.js";
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

/**
 * What the pass needs of the tick's shared algorithm context: the live modules
 * (their versions name the artifact keys) and whether folding is suspended.
 * Typed structurally HERE so this module imports nothing from `scheduled.ts`: the
 * edge runs one way, from the tick to the pass.
 */
export interface PassAlgorithmContext {
  readonly modules: ReadonlyMap<string, { readonly version: string }>;
  /** `undefined` on the healthy path; anything else suspends every live write. */
  readonly mismatch: unknown;
}

export interface LiveEventPassOptions {
  /** Every open window, foldable and probe alike. */
  readonly windows: readonly LiveWindowEntry[];
  /** The map `readOpenWindowCursors` returned at the top of the tick. */
  readonly cursors: ReadonlyMap<string, EventCursor>;
  readonly live: LiveTickContext;
  readonly nowIso: string;
  readonly tbaCtx: TbaClientContext;
  /** The tick's memoised accessor: loaded lazily, so a tick that polls nothing never pays for it. */
  readonly algorithmContext: () => Promise<PassAlgorithmContext>;
  /** The tick's generation and computed-at stamp, written onto every artifact the pass rewrites. */
  readonly stamp: Stamp;
}

export interface LiveEventPassResult {
  /** Official data requests that COMPLETED this tick, 304 or 200. A throwing poll is counted in neither this nor anything else. */
  readonly officialDataPolled: number;
  /** Event artifacts the pass rewrote this tick, summed over algorithms and events. */
  readonly officialDataWritten: number;
}

/** The two figures as zeros: the returns the pass is deliberately unreachable from. */
export const NO_OFFICIAL_DATA: LiveEventPassResult = { officialDataPolled: 0, officialDataWritten: 0 };

type OfficialEndpoint = "rankings" | "alliances";

/** One endpoint's parsed non empty 200, waiting to be merged into every algorithm's artifact. */
interface Gathered {
  readonly endpoint: OfficialEndpoint;
  /** Ranked teams, or alliances: the figure the endpoint's log row carries. */
  readonly count: number;
  readonly etag: string | null;
  readonly lastModified: string | undefined;
  readonly apply: (artifact: EventArtifact) => EventArtifact;
  /** What this endpoint contributes to an artifact, as text, so two artifacts compare exactly. */
  readonly projection: (artifact: EventArtifact) => string;
}

function rankingsProjection(artifact: EventArtifact): string {
  return JSON.stringify({
    teams: artifact.teams.map((row) => [row.teamKey, row.rank ?? null, row.record ?? null, row.rp ?? null]),
    standings: artifact.standings ?? null,
  });
}

function alliancesProjection(artifact: EventArtifact): string {
  return JSON.stringify(artifact.alliances ?? null);
}

function warnOfficialDataFailed(eventKey: string, endpoint: string, error: unknown): void {
  console.warn(JSON.stringify({ msg: "official-data-failed", endpoint, eventKey, error: (error instanceof Error ? error.message : String(error)).slice(0, 300) }));
}

export async function runLiveEventPass(env: Env, counter: SubrequestCounter, options: LiveEventPassOptions): Promise<LiveEventPassResult> {
  const { cursors, live, nowIso, tbaCtx, stamp } = options;
  const nowMs = Date.parse(nowIso);
  let officialDataPolled = 0;
  let officialDataWritten = 0;

  for (const eventKey of sortEventKeys(options.windows.map((w) => w.eventKey))) {
    try {
      const stateKey = liveIngestCursorKey(eventKey);
      const stored = parseLiveIngestState(cursors.get(stateKey)?.lastFoldedMatchKey);
      const facts = live.phaseFacts.get(eventKey);
      const derivePhase = (current: EventPhase, alliancesKnown: boolean): EventPhase => {
        if (facts !== undefined) return deriveEventPhase(facts, alliancesKnown);
        // No fresh match list: the phase stays what was stored, except that the
        // alliances endpoint answering during alliance selection IS the move to
        // alliances-posted, and nothing else would notice it on a quiet tick.
        return current === "quals-complete" && alliancesKnown ? "alliances-posted" : current;
      };
      const phase = derivePhase(stored.phase, stored.alliancesSeen);
      let state: LiveIngestState = { ...stored, phase };
      live.ingest.setPhase(eventKey, phase);

      const wanted = endpointsToPoll(phase, state, nowMs);

      // ---- Gather: one conditional request per wanted endpoint ----------------
      const gathered: Gathered[] = [];

      if (wanted.rankings) {
        try {
          counter.spend(1);
          const poll = await pollEventRankings(tbaCtx, eventKey, state.rankingsEtag ?? undefined);
          officialDataPolled++;
          if (poll.status === "ok") {
            const normalized = normalizeEventRankings(tbaEventRankingsResponseSchema.parse(poll.body), eventKey);
            if (normalized.length === 0) {
              // A null body or an empty list is a real answer, not a failure: keep
              // the ETag so an unchanged answer is a 304 next time, write nothing.
              state = { ...state, rankingsEtag: poll.etag ?? null };
            } else {
              gathered.push({
                endpoint: "rankings",
                count: normalized.length,
                etag: poll.etag ?? null,
                lastModified: poll.lastModified,
                apply: (artifact) => applyOfficialRankings(artifact, normalized),
                projection: rankingsProjection,
              });
            }
          }
        } catch (error) {
          warnOfficialDataFailed(eventKey, "rankings", error);
          live.ingest.failure(eventKey, "rankings", error);
        }
      }

      if (wanted.alliances) {
        try {
          counter.spend(1);
          const poll = await pollEventAlliances(tbaCtx, eventKey, state.alliancesEtag ?? undefined);
          officialDataPolled++;
          if (poll.status === "ok") {
            const normalized = normalizeEventAlliances(tbaAllianceResponseSchema.parse(poll.body));
            if (normalized.length === 0) {
              state = { ...state, alliancesEtag: poll.etag ?? null };
            } else {
              gathered.push({
                endpoint: "alliances",
                count: normalized.length,
                etag: poll.etag ?? null,
                lastModified: poll.lastModified,
                apply: (artifact) => applyOfficialAlliances(artifact, normalized),
                projection: alliancesProjection,
              });
            }
          }
        } catch (error) {
          warnOfficialDataFailed(eventKey, "alliances", error);
          live.ingest.failure(eventKey, "alliances", error);
        }
      }

      // ---- Apply: ONE read and at most ONE write per algorithm, however many
      // endpoints changed ------------------------------------------------------
      if (gathered.length > 0) {
        let skippedAlgorithm = false;
        let failed = false;
        const wrote = new Set<OfficialEndpoint>();
        try {
          const { modules, mismatch } = await options.algorithmContext();
          if (mismatch !== undefined) {
            // Write nothing and store no ETag: consuming it while skipping the
            // write would strand the data until TBA's own ETag changed.
            skippedAlgorithm = true;
          } else {
            for (const [algorithmId, algorithm] of modules) {
              const params = { page: "event" as const, eventKey, algorithmId, version: algorithm.version };
              const text = await readArtifactObject(env, counter, artifactKey(params));
              let existing: EventArtifact | undefined;
              if (text !== undefined) {
                try {
                  existing = checkLiveEventArtifactShape(JSON.parse(text));
                } catch {
                  existing = undefined;
                }
              }
              if (existing === undefined) {
                skippedAlgorithm = true;
                continue;
              }
              let next: EventArtifact = existing;
              for (const item of gathered) next = item.apply(next);
              const changed = gathered.filter((item) => item.projection(next) !== item.projection(existing));
              if (changed.length === 0) continue;
              await writeArtifactObject(env, counter, "event", params, { ...next, generation: stamp.generation, computedAt: stamp.computedAt });
              officialDataWritten++;
              for (const item of changed) wrote.add(item.endpoint);
            }
          }
        } catch (error) {
          failed = true;
          for (const item of gathered) {
            warnOfficialDataFailed(eventKey, item.endpoint, error);
            live.ingest.failure(eventKey, item.endpoint, error);
          }
        }
        for (const item of gathered) {
          if (!skippedAlgorithm && !failed) {
            const changedAt = wrote.has(item.endpoint) ? nowIso : undefined;
            state =
              item.endpoint === "rankings"
                ? { ...state, rankingsEtag: item.etag, rankingsSeen: true, ...(changedAt !== undefined ? { rankingsChangedAt: changedAt } : {}) }
                : { ...state, alliancesEtag: item.etag, alliancesSeen: true, ...(changedAt !== undefined ? { alliancesChangedAt: changedAt } : {}) };
          }
          if (wrote.has(item.endpoint)) {
            live.ingest.endpointChanged(eventKey, item.endpoint, { lastModified: item.lastModified, detail: item.endpoint === "rankings" ? { rankedTeams: item.count } : { alliances: item.count } });
            live.ingest.endpointPublished(eventKey, item.endpoint);
          }
        }
      }

      // The alliances endpoint having answered moves the phase THIS tick, so the
      // transition row is written the tick the alliances arrive.
      state = { ...state, phase: derivePhase(state.phase, state.alliancesSeen) };
      live.ingest.setPhase(eventKey, state.phase);

      // ---- Persist the state once, and log a phase transition ----------------
      const stateText = serializeLiveIngestState(state);
      if (stateText === serializeLiveIngestState(stored)) continue;

      // The remembered state is written BEFORE a phase row is logged: a write that
      // fails leaves the stored state unchanged, so the next tick derives the same
      // change again and retries, and the log never holds a transition the state
      // does not.
      counter.spend(1);
      await writeEventCursor(env.DB, {
        eventKey: stateKey,
        tbaEtag: null,
        lastFoldedMatchKey: stateText,
        lastPolledAt: nowIso,
        lastAdvancedAt: null,
        rosterEtag: null,
      });
      if (state.phase === stored.phase) continue;
      live.ingest.phaseChanged(eventKey, stored.phase, state.phase);

      if (state.phase === "complete") {
        const cutoff = new Date(Date.parse(nowIso) - INGEST_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
        counter.spend(1);
        await env.DB.prepare(INGEST_LOG_PRUNE_SQL).bind(cutoff).run();
      }
    } catch (error) {
      console.warn(JSON.stringify({ msg: "live-event-pass-failed", eventKey, error: (error instanceof Error ? error.message : String(error)).slice(0, 300) }));
      live.ingest.failure(eventKey, "live-event-pass", error);
    }
  }
  return { officialDataPolled, officialDataWritten };
}
