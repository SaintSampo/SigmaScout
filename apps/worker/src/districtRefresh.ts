/**
 * THE DISTRICT PASS: one conditional TBA rankings request per live district
 * per tick, merged into the already-published `v1/district/{key}.json` through
 * the ONE shared producer (`packages/harness/districtRankingsMerge.ts`) and
 * written back. This is the live half of SC-1 — the only thing in phase 10
 * that makes a published district's numbers move between offline republishes.
 *
 * Extracted into its own module for the same reason `artifactMerge.ts` states
 * for itself: the edge runs ONE WAY ONLY. `scheduled.ts` imports this pass;
 * this pass never imports `scheduled.ts`.
 *
 * `runDistrictRefresh` NEVER THROWS. Every district's work sits inside its own
 * try/catch, and the only pass-level work — `liveDistrictsOf` (pure) and one
 * `readEventCursors` call — precedes the loop. That contract is load-bearing,
 * not defensive style: the call site sits upstream of `writeTickMeta`, so an
 * escaping throw would cost the tick its rotation offset and permanently
 * starve the tail of the live-event list (`subrequestCounter.ts`'s `rotate`
 * header states why that is an omission, not a delay).
 *
 * THE WORKER HAS NO CORPUS (`10-RESEARCH.md` Pitfall 3). It can only read back
 * what the offline publisher wrote, merge in what `/district/{key}/rankings`
 * supplies, and let the shared merge recompute the verdicts. Two consequences
 * are pinned by tests and must not be softened:
 *   - A MISSING `v1/district/{key}.json` is skipped with a warn and NEVER
 *     created. The Worker has no registrations, no team nicknames and no slot
 *     capacities; a district invented here would be a published guess.
 *   - An EMPTY rankings payload throws `DistrictMergeError` inside the merge,
 *     before any row is touched, so a null-ish TBA response can never blank a
 *     published district.
 *
 * This module never simulates and never calls `buildDistrictArtifact`. It
 * imports no `packages/corpus/`, no `better-sqlite3`, no `node:` built-in and
 * nothing under `packages/core/algorithms/simulation/` — asserted statically by
 * `apps/worker/test/scheduled.district.test.ts`.
 *
 * KNOWN FRESHNESS LIMIT, recorded rather than fixed: a district's awards that
 * post after every member event's live window has CLOSED are not picked up
 * until the next offline republish. A window is padded one hour past the last
 * observed match (`LIVE_WINDOW_PAD_MS`, `packages/harness/manifestSchemas.ts`);
 * an award ceremony later that night falls outside it. This is a consequence of
 * the window definition, not a defect in this pass, and it is carried into
 * `docs/worker-operations.md` by 10-08.
 */
import { districtDetailKey, DistrictArtifactSchema, type DistrictArtifact } from "../../../packages/harness/pageArtifacts.js";
import { applyDistrictRankings } from "../../../packages/harness/districtRankingsMerge.js";
import { districtRankingsCursorKey } from "../../../packages/harness/stateBaseline.js";
import type { LiveWindowEntry } from "../../../packages/harness/manifestSchemas.js";
import type { Stamp } from "./artifactMerge.js";
import { readArtifactObject, writeDistrictArtifactObject } from "./artifactWriter.js";
import { readEventCursors, writeEventCursor, type EventCursor } from "./stateStore.js";
import type { SubrequestCounter } from "./subrequestCounter.js";
import { pollDistrictRankings, type TbaClientContext } from "./tbaPoll.js";
import type { Env } from "./env.js";

/**
 * TBA's own year-prefixed district key shape: four digits then lowercase
 * letters/digits (e.g. `2026pnw`). A district key becomes BOTH a TBA URL path
 * segment and an R2 object key, so it is validated before it can become
 * either — a non-matching key is skipped with a warn and counted failed, never
 * encoded-and-hoped. The value itself is joined from the corpus `districts`
 * table by the offline builder (10-03), never concatenated, so a rejection
 * here means the manifest itself is wrong.
 */
export const DISTRICT_KEY_PATTERN = /^\d{4}[a-z0-9]+$/;

/**
 * The live windows of this tick, grouped by the district each belongs to.
 * THIS IS THE WHOLE DISCOVERY MECHANISM: an entry's `districtKey` (10-03's
 * addition to `LiveWindowEntrySchema`) is the only way the Worker learns a
 * district exists at all — it cannot read `events.district_key`, it has no
 * corpus, and no second R2 object is read (`10-RESEARCH.md` Open Questions 2
 * and 3).
 *
 * An entry whose `districtKey` is ABSENT (a manifest published before phase
 * 10) or `null` (a non-district event) contributes nothing, which is what
 * makes the whole pass a no-op against a pre-republish manifest.
 *
 * Districts are iterated in sorted key order so two ticks over the same live
 * set do the same work in the same order.
 */
export function liveDistrictsOf(windows: readonly LiveWindowEntry[]): Map<string, LiveWindowEntry[]> {
  const byDistrict = new Map<string, LiveWindowEntry[]>();
  for (const window of windows) {
    const districtKey = window.districtKey;
    if (typeof districtKey !== "string" || districtKey.length === 0) continue;
    const existing = byDistrict.get(districtKey);
    if (existing) existing.push(window);
    else byDistrict.set(districtKey, [window]);
  }
  return new Map([...byDistrict.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
}

/** The four counts `TickResult` carries as required fields, so every return site in `runTick` must state them and a silently-failing district is impossible to miss in the tick log (threat T-10-05-07). */
export interface DistrictRefreshResult {
  readonly districtsConsidered: number;
  readonly districtsRefreshed: number;
  readonly districtsUnchanged: number;
  readonly districtsFailed: number;
}

export interface RunDistrictRefreshOptions {
  /** The live windows the tick ACTUALLY processed — foldable plus promoted. See `scheduled.ts`'s call site for why a never-promoted probe window is deliberately excluded. */
  readonly windows: readonly LiveWindowEntry[];
  readonly stamp: Stamp;
  readonly nowIso: string;
}

/** The cursor row shape used for a reserved key that has never been written. */
function emptyCursor(eventKey: string): EventCursor {
  return { eventKey, tbaEtag: null, lastFoldedMatchKey: null, lastPolledAt: null, lastAdvancedAt: null };
}

/**
 * One tick's district pass. See this module's header for the never-throws
 * contract and the two refusals.
 *
 * Order, and the reason for it: the rankings poll comes FIRST, before any R2
 * read, so a district with nothing moving costs exactly one conditional TBA
 * request and nothing else.
 */
export async function runDistrictRefresh(env: Env, counter: SubrequestCounter, tbaCtx: TbaClientContext, options: RunDistrictRefreshOptions): Promise<DistrictRefreshResult> {
  const { windows, stamp, nowIso } = options;
  const districts = liveDistrictsOf(windows);

  let districtsRefreshed = 0;
  let districtsUnchanged = 0;
  let districtsFailed = 0;

  if (districts.size === 0) {
    return { districtsConsidered: 0, districtsRefreshed: 0, districtsUnchanged: 0, districtsFailed: 0 };
  }

  // ONE subrequest regardless of key count — the same property `readTickState`
  // exploits for the tick-meta sentinel plus every baseline marker.
  counter.spend(1);
  const cursors = await readEventCursors(
    env.DB,
    [...districts.keys()].map((districtKey) => districtRankingsCursorKey(districtKey))
  );

  for (const districtKey of districts.keys()) {
    try {
      if (!DISTRICT_KEY_PATTERN.test(districtKey)) {
        districtsFailed++;
        console.warn(JSON.stringify({ msg: "district-key-rejected", districtKey }));
        continue;
      }

      const cursorKey = districtRankingsCursorKey(districtKey);
      const cursor = cursors.get(cursorKey) ?? emptyCursor(cursorKey);

      counter.spend(1);
      const poll = await pollDistrictRankings(tbaCtx, districtKey, cursor.tbaEtag ?? undefined);

      if (poll.status === "not-modified") {
        districtsUnchanged++;
        continue;
      }

      const artifactKeyString = districtDetailKey(districtKey);
      const existingText = await readArtifactObject(env, counter, artifactKeyString);
      if (existingText === undefined) {
        districtsFailed++;
        console.warn(JSON.stringify({ msg: "district-artifact-missing", districtKey, key: artifactKeyString }));
        continue;
      }
      const existing: DistrictArtifact = DistrictArtifactSchema.parse(JSON.parse(existingText));

      const merged = applyDistrictRankings({ artifact: existing, rankings: poll.body, generation: stamp.generation, computedAt: stamp.computedAt });

      const bytes = await writeDistrictArtifactObject(env, counter, districtKey, merged);

      if (poll.etag !== undefined && poll.etag !== cursor.tbaEtag) {
        counter.spend(1);
        await writeEventCursor(env.DB, { ...cursor, tbaEtag: poll.etag, lastPolledAt: nowIso });
      }

      districtsRefreshed++;
      console.log(JSON.stringify({ msg: "district-refreshed", districtKey, bytes, teams: merged.teams.length }));
    } catch (err) {
      districtsFailed++;
      console.warn(JSON.stringify({ msg: "district-refresh-failed", districtKey, error: err instanceof Error ? err.message : String(err) }));
    }
  }

  return { districtsConsidered: districts.size, districtsRefreshed, districtsUnchanged, districtsFailed };
}
