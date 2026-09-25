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
import { districtDetailKey, DistrictArtifactSchema, DistrictEventStateSchema, type DistrictArtifact, type DistrictEventState } from "../../../packages/harness/pageArtifacts.js";
import { applyDistrictEventState, applyDistrictRankings } from "../../../packages/harness/districtRankingsMerge.js";
import { districtRankingsCursorKey, eventAwardsCursorKey } from "../../../packages/harness/stateBaseline.js";
import type { LiveWindowEntry } from "../../../packages/harness/manifestSchemas.js";
import { tbaEventAwardsResponseSchema } from "../../../packages/ingest/schemas.js";
import type { MatchDerivedEventState } from "./districtEventState.js";
import type { Stamp } from "./artifactMerge.js";
import { readArtifactObject, writeDistrictArtifactObject } from "./artifactWriter.js";
import { readEventCursors, writeEventCursor, type EventCursor } from "./stateStore.js";
import type { SubrequestCounter } from "./subrequestCounter.js";
import { pollDistrictRankings, pollEventAwards, type TbaClientContext } from "./tbaPoll.js";
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
  /** This tick's own per-event observations, filled by `processEvent` above the `newlyFolded.length === 0` return. An event absent from this map contributed no observation this tick (its match poll was a 304, or it failed). */
  readonly matchDerivedState: ReadonlyMap<string, MatchDerivedEventState>;
  readonly stamp: Stamp;
  readonly nowIso: string;
}

/** The cursor row shape used for a reserved key that has never been written. */
function emptyCursor(eventKey: string): EventCursor {
  return { eventKey, tbaEtag: null, lastFoldedMatchKey: null, lastPolledAt: null, lastAdvancedAt: null };
}

/**
 * The `state` block already published for `eventKey`, found on ANY team's
 * `eventPoints` or `remainingEvents` row. Every row for one event carries the
 * same block (both merge entry points write it across every matching row), so
 * the first hit is authoritative.
 */
function publishedStateFor(artifact: DistrictArtifact, eventKey: string): DistrictEventState | undefined {
  for (const team of artifact.teams) {
    for (const row of team.eventPoints) if (row.eventKey === eventKey && row.state !== undefined) return row.state;
    for (const row of team.remainingEvents) if (row.eventKey === eventKey && row.state !== undefined) return row.state;
  }
  return undefined;
}

/** True when the artifact carries at least one row for `eventKey`. */
function artifactCarriesEvent(artifact: DistrictArtifact, eventKey: string): boolean {
  return artifact.teams.some((team) => team.eventPoints.some((row) => row.eventKey === eventKey) || team.remainingEvents.some((row) => row.eventKey === eventKey));
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
  const { windows, matchDerivedState, stamp, nowIso } = options;
  const districts = liveDistrictsOf(windows);

  let districtsRefreshed = 0;
  let districtsUnchanged = 0;
  let districtsFailed = 0;

  if (districts.size === 0) {
    return { districtsConsidered: 0, districtsRefreshed: 0, districtsUnchanged: 0, districtsFailed: 0 };
  }

  // ONE subrequest regardless of key count — the same property `readTickState`
  // exploits for the tick-meta sentinel plus every baseline marker. Every
  // district's rankings key AND every live member event's awards key ride in
  // this one read, so the awards gate below never costs a second round trip.
  counter.spend(1);
  const cursorKeys = [
    ...[...districts.keys()].map((districtKey) => districtRankingsCursorKey(districtKey)),
    ...[...districts.values()].flatMap((entries) => entries.map((entry) => eventAwardsCursorKey(entry.eventKey))),
  ];
  const cursors = await readEventCursors(env.DB, cursorKeys);

  for (const [districtKey, memberWindows] of districts) {
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

      // THE CHEAP STEADY STATE, and the reason the rankings poll comes first:
      // nothing moved and nothing was observed, so this district costs exactly
      // one conditional TBA request and NO R2 read at all.
      const observedAny = memberWindows.some((entry) => matchDerivedState.has(entry.eventKey));
      if (poll.status === "not-modified" && !observedAny) {
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

      // The five-field state map, one entry per live member event this pass can
      // say something honest about.
      const eventState = new Map<string, DistrictEventState>();
      const awardsCursorWrites: EventCursor[] = [];

      for (const entry of memberWindows) {
        const eventKey = entry.eventKey;
        const published = publishedStateFor(existing, eventKey);
        const observed = matchDerivedState.get(eventKey);
        // Neither this tick nor the published artifact knows anything about
        // this event: say nothing rather than publish a default.
        if (observed === undefined && published === undefined) continue;
        // The artifact carries no row for this event at all — a member event
        // registered since the last offline republish. There is nowhere to put
        // the observation, and handing it to `applyDistrictEventState` would
        // trip that function's refusal, which exists to catch a genuine caller
        // bug. Drop it here instead; the next republish creates the row.
        if (!artifactCarriesEvent(existing, eventKey)) continue;

        const matchDerived: MatchDerivedEventState =
          observed ?? {
            qualMatchesPlayed: published!.qualMatchesPlayed,
            qualMatchesTotal: published!.qualMatchesTotal,
            alliancesPicked: published!.alliancesPicked,
            playoffsDone: published!.playoffsDone,
          };

        let awardsPosted = false;
        if (published?.awardsPosted === true) {
          // AWARDS DO NOT UN-POST. A monotone fact needs asking once, so a
          // published `true` skips the request forever.
          awardsPosted = true;
        } else if (matchDerived.playoffsDone && DISTRICT_KEY_PATTERN.test(eventKey)) {
          const awardsKey = eventAwardsCursorKey(eventKey);
          const awardsCursor = cursors.get(awardsKey) ?? emptyCursor(awardsKey);
          counter.spend(1);
          const awardsPoll = await pollEventAwards(tbaCtx, eventKey, awardsCursor.tbaEtag ?? undefined);
          if (awardsPoll.status === "ok") {
            const awards = tbaEventAwardsResponseSchema.parse(awardsPoll.body);
            awardsPosted = awards !== null && awards.length > 0;
            if (awardsPoll.etag !== undefined && awardsPoll.etag !== awardsCursor.tbaEtag) {
              awardsCursorWrites.push({ ...awardsCursor, tbaEtag: awardsPoll.etag, lastPolledAt: nowIso });
            }
          }
          // A 304 means "unchanged since the last time this was seen", and the
          // only outcome that gets cached is an EMPTY list (a non-empty one
          // publishes `awardsPosted: true`, which never asks again). So a 304
          // is false.
        }
        // When `playoffsDone` is false no request is made at all and
        // `awardsPosted` stays false: an award cannot post before the playoffs
        // finish, so there is nothing a request could tell us.

        eventState.set(eventKey, DistrictEventStateSchema.parse({ ...matchDerived, awardsPosted }));
      }

      // Build the candidate with the EXISTING artifact's own stamp held
      // constant, so the comparison below measures CONTENT and not the clock.
      const candidate =
        poll.status === "ok"
          ? applyDistrictRankings({ artifact: existing, rankings: poll.body, generation: existing.generation, computedAt: existing.computedAt, eventState })
          : applyDistrictEventState({ artifact: existing, eventState, generation: existing.generation, computedAt: existing.computedAt });

      // ETag cursors are written LAST, and only once nothing further can fail
      // for this district. Caching an ETag before a put that then rejects would
      // hand the next tick a 304 and leave the stale artifact in place forever
      // — the write is what earns the right to stop asking.
      const writeCursors = async (): Promise<void> => {
        if (poll.status === "ok" && poll.etag !== undefined && poll.etag !== cursor.tbaEtag) {
          counter.spend(1);
          await writeEventCursor(env.DB, { ...cursor, tbaEtag: poll.etag, lastPolledAt: nowIso });
        }
        for (const awardsCursor of awardsCursorWrites) {
          counter.spend(1);
          await writeEventCursor(env.DB, awardsCursor);
        }
      };

      // THE ASYMMETRY, stated: a false "changed" costs one extra R2 write; a
      // false "unchanged" is impossible, because both sides are outputs of the
      // SAME `DistrictArtifactSchema.parse` and therefore share a key order, so
      // equal serializations imply equal content.
      if (JSON.stringify(candidate) === JSON.stringify(existing)) {
        await writeCursors();
        districtsUnchanged++;
        continue;
      }

      const bytes = await writeDistrictArtifactObject(env, counter, districtKey, { ...candidate, generation: stamp.generation, computedAt: stamp.computedAt });
      await writeCursors();

      districtsRefreshed++;
      console.log(JSON.stringify({ msg: "district-refreshed", districtKey, bytes, teams: candidate.teams.length }));
    } catch (err) {
      districtsFailed++;
      console.warn(JSON.stringify({ msg: "district-refresh-failed", districtKey, error: err instanceof Error ? err.message : String(err) }));
    }
  }

  return { districtsConsidered: districts.size, districtsRefreshed, districtsUnchanged, districtsFailed };
}
