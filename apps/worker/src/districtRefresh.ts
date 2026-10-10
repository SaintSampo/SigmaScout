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
 * try/catch, every awards request sits inside its own try within that (see
 * AN AWARDS REQUEST THAT FAILS below), and the only pass-level work —
 * `liveDistrictsOf` (pure) and one `readEventCursors` call — precedes the
 * loop. That contract is load-bearing, not defensive style: the call site
 * sits upstream of `writeTickMeta`, so an escaping throw would cost the tick
 * its rotation offset and permanently starve the tail of the live-event list
 * (`subrequestCounter.ts`'s `rotate` header states why that is an omission,
 * not a delay).
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
 * THE AWARDS FLAG AND THE WINNER RECORDS (quick task 261009-r9x). The Locks
 * guarantee holds slots back until an event's awards are done, and
 * `state.awardsPosted` is what ends that reservation, so this pass must never
 * turn it true early. It no longer decides the flag at all. It hands the
 * shared merge two things: the state map, where `awardsPosted` is only what is
 * ALREADY published (a published true stays true, anything else is false), and
 * the awards lists fetched this tick. The merge raises the flag through the
 * one shared rule (`packages/core/districts/eventAwards.ts`): a judged award
 * listed AND award points at the event in the rankings as merged this tick.
 * The same step records who won each qualifying award, so the flag, the
 * winner records and both lock verdicts land in ONE R2 put.
 *
 * WHAT THE AWARDS CURSOR ROW HOLDS. `__event_awards__:{eventKey}` stores the
 * ETag of the last awards list this pass MERGED, whatever the flag says. It
 * says nothing about the flag: the flag on the artifact does. A row with a
 * NULL ETag is a retry marker (see below) and is asked with no ETag.
 *
 * THE ORDER FOR ONE DISTRICT, and the reason for it:
 *   1. The rankings request, conditional.
 *   2. One awards request per member event that has an awards cursor row,
 *      conditional on its stored ETag. A 200 means the list changed.
 *   3. THE GATE. The district goes on when the rankings changed, OR a member
 *      event has a match observation this tick, OR an awards list changed.
 *      Otherwise it is unchanged and NOTHING is read from R2. A quiet district
 *      therefore costs one conditional rankings request plus one conditional
 *      awards request per event with a cursor row, and no R2 read.
 *   4. The artifact read.
 *   5. Per member event: when no list is in hand, ONE awards request with no
 *      ETag, in exactly two cases. First, the flag still waits, the playoffs
 *      are done, and the event either answered 304 in step 2 or has no cursor
 *      row: a 304 carries no list, and the rule needs the list to be read
 *      against the rankings merged this tick. Second, the flag is already true
 *      and the event has no cursor row (the offline publisher set the flag, so
 *      the Worker has never asked): one ask gives it a row, and from then on a
 *      changed list passes the gate. This is the only unconditional ask, and
 *      it happens only on a tick that already read the artifact.
 *   6. One candidate build, with both maps. One put when it differs.
 *   7. Cursor writes LAST: every list handed to the merge stores the ETag of
 *      its response, so the next quiet tick is a cheap 304. That holds for an
 *      empty list and for a Winner and Finalist only list too.
 *
 * A CHANGED LIST PASSES THE GATE. A finished event stops producing match
 * observations once its match list goes 304, and its rankings go 304 too, so
 * without step 2 a late award (or a District Championship Winner listed on an
 * otherwise quiet tick) would never be seen. With it, the award is recorded
 * on the tick its list changes.
 *
 * AN AWARDS REQUEST THAT FAILS IS NOT FATAL TO THE DISTRICT. A request that
 * throws, answers a status other than 200 or 304, or returns a body that
 * fails the schema logs one `district-awards-poll-failed` warn (district key,
 * event key, a short reason) and counts as no awards news for that event this
 * tick: its flag is unchanged, nothing is merged for it, it is not asked a
 * second time, and the district carries on with its rankings merge.
 * `districtsFailed` is not incremented. A FAILED ASK IS ALWAYS RETRIED: when
 * the event's flag is not yet true, its cursor row is written with a NULL
 * ETag at the end of the tick (created if absent), never with an ETag from
 * the failed response. Step 2 asks a null ETag row with no ETag, so the next
 * tick's 200 passes the gate and the rule is read again. Without the marker a
 * tick that merged the award points while its awards ask failed would be
 * followed by conditional 304s on an unchanged list for ever, and the flag
 * would never turn true. An event whose flag is already true keeps its row as
 * it was: its next conditional ask is the retry.
 *
 * THE AWARDS CURSORS ARE WRITTEN BEFORE THE RANKINGS CURSOR. If an awards
 * cursor write throws, the rankings cursor is not written that tick, so the
 * next tick's rankings request is a 200 again and passes the gate again.
 *
 * KNOWN FRESHNESS LIMIT, recorded rather than fixed: a district's awards, and
 * the award points that go with them, that post after every member event's
 * live window has CLOSED are not picked up until the next offline republish.
 * A window is padded one hour past the last observed match
 * (`LIVE_WINDOW_PAD_MS`, `packages/harness/manifestSchemas.ts`); an award
 * ceremony later that night falls outside it. In that case the flag stays
 * false, so the reservations stay held. This is a consequence of the window
 * definition, not a defect in this pass, and it is carried into
 * `docs/worker-operations.md` by 10-08.
 *
 * A SECOND LIMIT, recorded beside it: an event with no awards cursor row
 * whose district is quiet may not be asked again while it stays quiet,
 * because step 2 asks only events that have a row and step 5 runs only once
 * the gate has passed. For an event whose flag still waits and whose playoffs
 * are done, every path through this pass leaves a row (a merged list, or a
 * retry marker), so the one way left to get there is a D1 cursor write
 * failing on the same tick an awards ask failed (or, the same failure one
 * step earlier, on the tick its first list was merged) while the rankings
 * answered 304. The flag stays false in that case, so the reservations stay
 * held. An event whose flag the offline publisher set true has no row until
 * the first tick that passes the gate, so an award listed for it before then
 * is not recorded until then.
 */
import { districtDetailKey, DistrictArtifactSchema, DistrictEventStateSchema, type DistrictArtifact, type DistrictEventState } from "../../../packages/harness/pageArtifacts.js";
import { applyDistrictEventState, applyDistrictRankings, type DistrictEventAwardInput } from "../../../packages/harness/districtRankingsMerge.js";
import { DISTRICT_KEY_PATTERN, EVENT_KEY_PATTERN } from "../../../packages/core/districts/keys.js";
import { districtRankingsCursorKey, eventAwardsCursorKey } from "../../../packages/harness/stateBaseline.js";
import type { LiveWindowEntry } from "../../../packages/harness/manifestSchemas.js";
import { tbaEventAwardsResponseSchema } from "../../../packages/ingest/schemas.js";
import type { MatchDerivedEventState } from "./districtEventState.js";
import type { Stamp } from "./artifactMerge.js";
import { readArtifactObject, writeDistrictArtifactObject } from "./artifactWriter.js";
import { readEventCursors, writeEventCursor, type EventCursor } from "./stateStore.js";
import type { SubrequestCounter } from "./subrequestCounter.js";
import { pollDistrictRankings, pollEventAwards, type TbaClientContext, type TbaConditionalBody } from "./tbaPoll.js";
import type { Env } from "./env.js";

/**
 * TBA's own year-prefixed district key shape: four digits then lowercase
 * letters/digits (e.g. `2026pnw`). A district key becomes BOTH a TBA URL path
 * segment and an R2 object key, so it is validated before it can become
 * either — a non-matching key is skipped with a warn and counted failed, never
 * encoded-and-hoped. The value itself is joined from the corpus `districts`
 * table by the offline builder (10-03), never concatenated, so a rejection
 * here means the manifest itself is wrong.
 *
 * DECLARED IN `packages/core/districts/keys.ts` SINCE THE PHASE 10 REVIEW
 * (WR-10) and re-exported here, so this module's existing importers are
 * unchanged. The browser validates `?district=` with the SAME declaration at
 * `apps/web/src/lib/searchParams.ts`'s schema boundary; before the move the
 * Worker refused a malformed key and the browser did not.
 *
 * ITS SIBLING `EVENT_KEY_PATTERN` EXISTS, and is what validates an EVENT key
 * below. Until the phase 10 review (WR-03) this district pattern was the only
 * check applied to an event key before that key became `/event/{key}/awards`
 * and `eventAwardsCursorKey(eventKey)` — the two shapes coincide, so nothing
 * was wrong at runtime, but narrowing this one would have switched the awards
 * poll off with no test failing.
 */
export { DISTRICT_KEY_PATTERN, EVENT_KEY_PATTERN };

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
  return { eventKey, tbaEtag: null, lastFoldedMatchKey: null, lastPolledAt: null, lastAdvancedAt: null, rosterEtag: null };
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

/** One awards list fetched this tick, with the ETag of the response that carried it (`null` when TBA sent none). */
interface AwardsListInHand {
  readonly awards: readonly DistrictEventAwardInput[];
  readonly etag: string | null;
}

/**
 * One tick's district pass. See this module's header for the never-throws
 * contract, the two refusals, the order of the steps and the reason for it.
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
  // this one read, so knowing which events have an awards cursor row, and
  // what ETag each holds, never costs a second round trip. The awards
  // REQUESTS those rows lead to are counted where they are made.
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

      // STEP 1. The rankings request comes FIRST, before any R2 read.
      counter.spend(1);
      const poll = await pollDistrictRankings(tbaCtx, districtKey, cursor.tbaEtag ?? undefined);

      // This district's awards news for this tick. An event is in at most one
      // of the three: a list in hand (a 200), a 304, or a failed ask.
      const awardsInHand = new Map<string, AwardsListInHand>();
      const awardsNotModified = new Set<string>();
      const awardsFailed = new Set<string>();

      /**
       * ONE awards request, inside its own try: a failure here is no awards
       * news for this event, never a failed district. The reason logged is
       * the poll error's own message (it names the event key and the HTTP
       * status, never the TBA key or a header) or a fixed phrase for a schema
       * failure, never the payload.
       */
      const askAwards = async (eventKey: string, cachedEtag: string | undefined): Promise<void> => {
        counter.spend(1);
        let awardsPoll: TbaConditionalBody;
        try {
          awardsPoll = await pollEventAwards(tbaCtx, eventKey, cachedEtag);
        } catch (err) {
          awardsFailed.add(eventKey);
          console.warn(JSON.stringify({ msg: "district-awards-poll-failed", districtKey, eventKey, reason: err instanceof Error ? err.message : String(err) }));
          return;
        }
        if (awardsPoll.status === "not-modified") {
          awardsNotModified.add(eventKey);
          return;
        }
        const parsed = tbaEventAwardsResponseSchema.safeParse(awardsPoll.body);
        if (!parsed.success) {
          awardsFailed.add(eventKey);
          console.warn(JSON.stringify({ msg: "district-awards-poll-failed", districtKey, eventKey, reason: "the awards response failed the schema" }));
          return;
        }
        // A `null` body is TBA's "no awards structure yet": an empty list.
        awardsInHand.set(eventKey, { awards: parsed.data ?? [], etag: awardsPoll.etag ?? null });
      };

      // STEP 2. Every member event that HAS an awards cursor row is asked
      // conditionally, before any R2 read. A row with a null ETag (a retry
      // marker, or a response that carried no ETag) is asked with none.
      //
      // AN EVENT KEY, CHECKED WITH THE EVENT PATTERN (WR-03). It becomes a TBA
      // URL path segment (`/event/{key}/awards`) and a D1 cursor row key, so
      // it is validated before it can become either — by the pattern that
      // describes what it IS, not by the district pattern that happens to
      // match the same strings today.
      for (const entry of memberWindows) {
        if (!EVENT_KEY_PATTERN.test(entry.eventKey)) continue;
        const awardsCursor = cursors.get(eventAwardsCursorKey(entry.eventKey));
        if (awardsCursor === undefined) continue;
        await askAwards(entry.eventKey, awardsCursor.tbaEtag ?? undefined);
      }

      // STEP 3, THE GATE, and the reason the requests above come first:
      // nothing moved, nothing was observed and no awards list changed, so
      // this district costs its conditional requests and NO R2 read at all.
      const observedAny = memberWindows.some((entry) => matchDerivedState.has(entry.eventKey));
      const awardsListChanged = awardsInHand.size > 0;
      if (poll.status === "not-modified" && !observedAny && !awardsListChanged) {
        districtsUnchanged++;
        continue;
      }

      // STEP 4. The artifact read.
      const artifactKeyString = districtDetailKey(districtKey);
      const existingText = await readArtifactObject(env, counter, artifactKeyString);
      if (existingText === undefined) {
        districtsFailed++;
        console.warn(JSON.stringify({ msg: "district-artifact-missing", districtKey, key: artifactKeyString }));
        continue;
      }
      const existing: DistrictArtifact = DistrictArtifactSchema.parse(JSON.parse(existingText));

      // STEP 5. The five-field state map, one entry per live member event this
      // pass can say something honest about, and beside it the awards lists
      // the merge will read.
      const eventState = new Map<string, DistrictEventState>();
      const eventAwards = new Map<string, readonly DistrictEventAwardInput[]>();
      // Events whose awards ask failed this tick while their flag still waits:
      // each gets a null ETag retry marker at the end.
      const retryMarkerEvents: string[] = [];

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
        // bug. Drop it here instead; the next republish creates the row. A
        // list in hand for such an event is dropped with it, and its ETag is
        // not stored.
        if (!artifactCarriesEvent(existing, eventKey)) continue;

        const matchDerived: MatchDerivedEventState =
          observed ?? {
            qualMatchesPlayed: published!.qualMatchesPlayed,
            qualMatchesTotal: published!.qualMatchesTotal,
            alliancesPicked: published!.alliancesPicked,
            playoffsDone: published!.playoffsDone,
          };

        // AWARDS DO NOT UN-POST: a published `true` is carried. Anything else
        // is carried as false, and only the shared merge can raise it, from
        // the list and the rankings merged this tick.
        const carriedFlag = published?.awardsPosted === true;
        const hasAwardsRow = cursors.has(eventAwardsCursorKey(eventKey));

        if (!awardsInHand.has(eventKey) && !awardsFailed.has(eventKey) && EVENT_KEY_PATTERN.test(eventKey)) {
          // THE ONE UNCONDITIONAL ASK, in exactly two cases.
          //
          // The flag still waits and the playoffs are done: a 304 in step 2
          // carried no list, and an event with no row has never been asked.
          // Either way the rule needs the list in hand to be read against the
          // rankings merged this tick. While the playoffs are not done no
          // request is made at all: an award cannot post before they finish.
          const flagWaits = !carriedFlag && matchDerived.playoffsDone && (awardsNotModified.has(eventKey) || !hasAwardsRow);
          // The flag is already true and the event has no row: the offline
          // publisher set it, so the Worker has never asked. One ask gives the
          // event a row, and from then on a changed list passes the gate. A
          // flag already true with a 304 in step 2 needs nothing.
          const neverAsked = carriedFlag && !hasAwardsRow;
          if (flagWaits || neverAsked) await askAwards(eventKey, undefined);
        }

        eventState.set(eventKey, DistrictEventStateSchema.parse({ ...matchDerived, awardsPosted: carriedFlag }));

        // EVERY list in hand is merged, whether or not the flag turns true
        // this tick: a winner is recorded as soon as TBA lists it.
        const inHand = awardsInHand.get(eventKey);
        if (inHand !== undefined) eventAwards.set(eventKey, inHand.awards);
        if (awardsFailed.has(eventKey) && !carriedFlag) retryMarkerEvents.push(eventKey);
      }

      // STEP 6. Build the candidate ONCE, with the EXISTING artifact's own
      // stamp held constant, so the comparison below measures CONTENT and not
      // the clock. The flag, the winner records and both lock verdicts come
      // out of this one build.
      const candidate =
        poll.status === "ok"
          ? applyDistrictRankings({ artifact: existing, rankings: poll.body, generation: existing.generation, computedAt: existing.computedAt, eventState, eventAwards })
          : applyDistrictEventState({ artifact: existing, eventState, eventAwards, generation: existing.generation, computedAt: existing.computedAt });

      // STEP 7. The awards cursor rows this tick earned, decided now and
      // written last. A row is written only when it would change, so a quiet
      // waiting event costs no D1 write.
      const awardsCursorWrites: EventCursor[] = [];
      for (const eventKey of eventAwards.keys()) {
        // The ETag of the list the merge just read, whatever the flag says and
        // whatever the list holds. A response with no ETag stores a null.
        const awardsKey = eventAwardsCursorKey(eventKey);
        const stored = cursors.get(awardsKey);
        const etag = awardsInHand.get(eventKey)!.etag;
        if (stored === undefined || stored.tbaEtag !== etag) awardsCursorWrites.push({ ...(stored ?? emptyCursor(awardsKey)), tbaEtag: etag, lastPolledAt: nowIso });
      }
      for (const eventKey of retryMarkerEvents) {
        // THE RETRY MARKER: a null ETag, never an ETag from the failed
        // response, created if the row is absent. The next tick asks it with
        // no ETag before the gate, and that 200 passes the gate.
        const awardsKey = eventAwardsCursorKey(eventKey);
        const stored = cursors.get(awardsKey);
        if (stored === undefined || stored.tbaEtag !== null) awardsCursorWrites.push({ ...(stored ?? emptyCursor(awardsKey)), tbaEtag: null, lastPolledAt: nowIso });
      }

      // ETag cursors are written LAST, and only once nothing further can fail
      // for this district. Caching an ETag before a put that then rejects would
      // hand the next tick a 304 and leave the stale artifact in place forever
      // — the write is what earns the right to stop asking.
      //
      // THE AWARDS CURSORS GO FIRST, THE RANKINGS CURSOR AFTER THEM. If an
      // awards cursor write throws, the rankings cursor is left unwritten, so
      // the next tick's rankings request is a 200 again, the gate passes
      // again, and the awards are asked again.
      const writeCursors = async (): Promise<void> => {
        for (const awardsCursor of awardsCursorWrites) {
          counter.spend(1);
          await writeEventCursor(env.DB, awardsCursor);
        }
        if (poll.status === "ok" && poll.etag !== undefined && poll.etag !== cursor.tbaEtag) {
          counter.spend(1);
          await writeEventCursor(env.DB, { ...cursor, tbaEtag: poll.etag, lastPolledAt: nowIso });
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
