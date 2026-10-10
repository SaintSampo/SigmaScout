/**
 * THE DISTRICT PASS: TBA's district rankings and awards, merged into the
 * already-published `v1/district/{key}.json` through the ONE shared producer
 * (`packages/harness/districtRankingsMerge.ts`) and written back. This is the
 * live half of SC-1 — the only thing in phase 10 that makes a published
 * district's numbers move between offline republishes.
 *
 * Extracted into its own module for the same reason `artifactMerge.ts` states
 * for itself: the edge runs ONE WAY ONLY. `scheduled.ts` imports this pass;
 * this pass never imports `scheduled.ts`.
 *
 * `runDistrictRefresh` NEVER THROWS. Every district's work sits inside its own
 * try/catch, every awards request sits inside its own try within that (see
 * AN AWARDS REQUEST THAT FAILS below), and the pass-level work that precedes
 * the loop is pure (`liveDistrictsOf`, the cadence) or sits inside a try of
 * its own (the cursor read, the suspension check). That contract is
 * load-bearing, not defensive style: the main call site sits upstream of
 * `writeTickMeta`, so an escaping throw would cost the tick its rotation
 * offset and permanently starve the tail of the live-event list
 * (`subrequestCounter.ts`'s `rotate` header states why that is an omission,
 * not a delay), and since quick task 261009-tx6 the pass is also reached from
 * the tick's two idle returns, where a throw would fail a tick that had
 * nothing else to do.
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
 * WHICH DISTRICTS THE PASS LOOKS AT: THE WATCH SET (quick task 261009-tx6).
 * An event's awards, and the award points that go with them, reach TBA after
 * its last match, often after its live window (padded one hour past the last
 * match) has closed. So the pass is handed two lists:
 *   - `windows`: the windows the tick ACTUALLY PROCESSED this tick (foldable,
 *     or promoted this tick). Their events are LIVE members.
 *   - `watchWindows`: every district window of the manifest that is live or
 *     ended within the last `DISTRICT_AWARDS_WATCH_MS` (24 hours). An entry
 *     the tick did not process is a WATCHED member.
 * The offline manifest builder keeps a closed district window for those same
 * 24 hours (`packages/harness/manifests.ts`), by the same constant and the
 * same half open bound, so a manifest rebuilt inside the watch does not end
 * it.
 *
 * A CALENDAR WINDOW NEEDS PROOF. A watched member whose window is `inferred`
 * (a calendar guess for an event the corpus held no match for) is kept only
 * when the event's own match cursor row shows a folded match
 * (`lastFoldedMatchKey` not null). Without that proof it is dropped, and a
 * district left with no member is not processed at all. Such a district has
 * cost its share of the pass's ONE cursor read and no district request: the
 * same rule that keeps a never promoted probe window from spending a TBA
 * request on an event that has not proven it has a single match.
 *
 * THE TWO CADENCES, read off the UTC minute of the tick. Nothing is stored,
 * on purpose: there is no marker to lose, and a cron tick that is skipped
 * only delays that look to the next mark.
 *   - A district with a LIVE member is processed every tick.
 *   - Any other watched district is processed only on a minute that is a
 *     multiple of `DISTRICT_QUIET_CADENCE_MINUTES` (5), out of consideration
 *     for TBA. On every other tick it costs nothing: no D1 read, no request.
 *   - THE FORCED LOOK: on a minute that is a multiple of
 *     `DISTRICT_FORCED_LOOK_MINUTES` (15), every processed district's
 *     rankings are asked with NO ETag and the gate is passed unconditionally.
 *     This applies to live districts too. It is the one mechanism that reads
 *     the settle clock without any waiting marker, merges again after an
 *     offline republish replaced the artifact, gives an awards cursor row to
 *     an event that has none, and repairs a failed cursor write. Nothing
 *     stays stuck for more than 15 minutes while its district is watched.
 *
 * SUSPENSION. The main call site sits below the tick's state generation
 * mismatch return, so a mismatch never reaches it. The two idle call sites
 * pass `isSuspended`, which answers the same question lazily. It is called at
 * most once, only after a district is due and proven, and before any TBA
 * request. True, or a throw, means the pass does nothing this tick and logs
 * one `district-pass-suspended` warn.
 *
 * THE AWARDS FLAG AND THE WINNER RECORDS (quick tasks 261009-r9x,
 * 261009-tx6 and 261009-vp9). The Locks guarantee holds slots back until an
 * event's awards are done, and `state.awardsPosted` is what ends that
 * reservation, so this pass must never turn it true early. IT DOES NOT DECIDE
 * THE FLAG. IT ONLY MEASURES. It hands the shared merge four things: the
 * state map, where `awardsPosted` is only what is ALREADY published (a
 * published true stays true, anything else is false), the awards lists
 * fetched this tick, the set of events whose list has stood unchanged for
 * `AWARDS_SETTLE_MS` (60 minutes), and the set of events whose list has stood
 * unchanged for `AWARDS_SETTLE_WITHOUT_IMPACT_MS` (12 hours).
 *
 * The merge decides, through the one shared rule
 * (`packages/core/districts/eventAwards.ts`). It knows what this pass does
 * not: the event's tier, whether it is a division, and which award types the
 * list holds. The rule needs a judged award listed, AND award points at the
 * event in the rankings as merged this tick, AND playoff points at the event
 * in those same rankings (a true flag closes every category of the event, so
 * it must not rise while the playoff points are still to land), AND:
 *   - where the list holds EVERY consuming award the event gives (Impact at
 *     a district tier event; Impact, Winner, Engineering Inspiration and
 *     Rookie All Star at a District Championship that is not a division;
 *     none at a division), the list unchanged for 60 minutes;
 *   - where one of them is not listed, the list unchanged for 12 hours. A
 *     list that has stood that long without the award is read as an event
 *     that gave none (12 district events since 2022 list no Impact).
 * The hour is there because TBA can list awards in batches: a flag raised at
 * the first judged award with points would release the slot held for an
 * Impact award that a later batch still brings. Waiting for the awards by
 * name is there because an hour can pass with the Impact still missing: the
 * award listed after it then took a held place (`frc5920` at `2026wasam` and
 * `2026wasno` in the replay). The same step records who won each qualifying
 * award on EVERY list in hand, whatever the flag says, so a winner is written
 * on the tick TBA lists it and the flag, the records and both lock verdicts
 * land in ONE R2 put.
 *
 * WHAT THE AWARDS CURSOR ROW HOLDS. `__event_awards__:{eventKey}` stores, in
 * `tbaEtag`, the ETag of the last awards list this pass MERGED, whatever the
 * flag says; in `lastAdvancedAt` THE TIME THAT ETAG LAST CHANGED (an existing
 * column this row did not use before, so no migration); and in `lastPolledAt`
 * the time the row was last written, which for a catch up event is the time
 * it was last asked. It says nothing about the flag: the flag on the artifact
 * does. A row with a NULL ETag is a retry marker (see below) and is asked
 * with no ETag.
 *
 * THE SETTLE CLOCK. A list in hand is settled when its ETag equals the row's
 * and the row's `lastAdvancedAt` is at least 60 minutes before this tick
 * (`awardsListSettled`, read from the row as it stood BEFORE this tick's
 * write). The SAME row answers the 12 hour question (quick task 261009-vp9):
 * the same call with `AWARDS_SETTLE_WITHOUT_IMPACT_MS` as its threshold. One
 * clock, read at two lengths: no second column, no second row, no new D1
 * read or write and no new request. Which length the flag needs is the
 * merge's decision, not this pass's.
 *
 * The list reads as CHANGED NOW, and the row is written with
 * `lastAdvancedAt` set to this tick's time, in three cases: no row exists,
 * the stored ETag differs from the list's, or the list has an ETag and the
 * row has no usable `lastAdvancedAt` (the row Worker 33d0ded7 wrote). For a
 * member event the row is written in no other case, so the stored time
 * stands. A list whose response carried no ETag never reads as settled. Every
 * unknown is the side that keeps the flag false.
 *
 * A FAILED ASK RESTARTS THE CLOCK ONLY ON A TICK THAT PASSES THE GATE. That
 * is the only tick that writes the retry marker, and the next list after a
 * marker has a differing ETag, so it reads as changed now. A failed ask on a
 * tick that does not pass the gate writes nothing and leaves the clock alone.
 *
 * THE ORDER FOR ONE DISTRICT, and the reason for it:
 *   1. The rankings request. Conditional on the stored ETag, except on a
 *      forced look, where no ETag is sent.
 *   2. One awards request per member event, live or watched, that has an
 *      awards cursor row, conditional on its stored ETag. A 200 means the
 *      list changed.
 *   3. THE GATE. The district goes on when the rankings changed, OR a member
 *      event has a match observation this tick, OR an awards list changed, OR
 *      this is a forced look. Otherwise it is unchanged and NOTHING is read
 *      from R2. A quiet district therefore costs one conditional rankings
 *      request plus one conditional awards request per event with a cursor
 *      row, and no R2 read.
 *   4. The artifact read.
 *   5. THE CATCH UP, on a forced look only. The artifact's own rows name
 *      older events whose state says the playoffs are done and the awards are
 *      not posted, and that are not members this tick: events whose awards or
 *      points landed after their watch ended. Their awards cursor rows are
 *      read in one counted D1 read (90 keys per statement), and at most
 *      `DISTRICT_AWARDS_CATCH_UP_MAX` (8) are chosen: an event never asked
 *      first, then the one asked longest ago, ties by week (a null week
 *      last), then by event key. Each chosen event is asked ONCE with no
 *      ETag, and its row is ALWAYS written afterwards with `lastPolledAt` set
 *      to this tick, whatever the answer, so the order rotates and events
 *      that can never post cannot starve a newer one. An event key read off
 *      the artifact is checked against `EVENT_KEY_PATTERN` before it becomes
 *      a URL segment or a cursor key.
 *   6. Per member event: when no list is in hand, ONE awards request with no
 *      ETag, in three cases. First, the flag still waits, the playoffs are
 *      done, and the event either answered 304 in step 2 or has no cursor
 *      row: a 304 carries no list, and the rule needs the list to be read
 *      against the rankings merged this tick. Second, ON A FORCED LOOK, the
 *      flag still waits and the event's window has ENDED, whatever its
 *      published state says about the playoffs: an event whose playoffs ran
 *      past its measured window would otherwise never be asked, and a judged
 *      award with its points and sixty settled minutes is itself proof the
 *      event is over. Third, the flag is already true and the event has no
 *      cursor row (the offline publisher set the flag, so the Worker has
 *      never asked): one ask gives it a row, and from then on a changed list
 *      passes the gate. These are the only unconditional asks, and they
 *      happen only on a tick that already read the artifact.
 *   7. One candidate build, with the state map, the lists and the two
 *      settled sets (60 minutes and 12 hours). One put when it differs.
 *   8. Cursor writes LAST: every list handed to the merge that reads as
 *      changed now stores the ETag of its response and this tick's time, so
 *      the next quiet tick is a cheap 304. That holds for an empty list and
 *      for a Winner and Finalist only list too.
 *
 * A CHANGED LIST PASSES THE GATE. A finished event stops producing match
 * observations once its match list goes 304, and its rankings go 304 too, so
 * without step 2 a late award (or a District Championship Winner listed on an
 * otherwise quiet tick) would not be seen until the next forced look. With
 * it, the award is recorded on the tick its list changes.
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
 * tick's 200 passes the gate and the rule is read again. An event whose flag
 * is already true keeps its row as it was: its next conditional ask is the
 * retry.
 *
 * THE AWARDS CURSORS ARE WRITTEN BEFORE THE RANKINGS CURSOR. If an awards
 * cursor write throws, the rankings cursor is not written that tick, so the
 * next tick's rankings request is a 200 again and passes the gate again.
 *
 * THE WORST CASE PER TICK, in subrequests. Every request and every D1 read or
 * write below is counted with `counter.spend`. With M member events and C
 * catch up events (C at most 8) in one district:
 *   - A forced look: at most 3M + 2C + 5. One rankings request, one artifact
 *     read, one put, one rankings cursor write, one catch up cursor read (one
 *     more for each further 90 candidates), two awards requests and one
 *     cursor write per member, one awards request and one cursor write per
 *     catch up event.
 *   - A tick that is not a forced look: at most 3M + 4 for a district that
 *     passes the gate, and M + 1 for one that does not.
 *   - The pass as a whole adds one cursor read statement per 90 keys, and on
 *     an idle call site two more for the suspension check (the algorithms
 *     manifest and the tick state, which a busy tick has paid for already).
 * A forced look sends one unconditional rankings request per processed
 * district, which is the one full rankings body the pass downloads every 15
 * minutes while a district is watched.
 *
 * WHAT IS TRUE NOW, AND THE LIMITS THAT REMAIN.
 *   - An event is watched for 24 hours after its window closes, and the
 *     manifest keeps that window for the same 24 hours. Awards and award
 *     points that land inside that day are picked up within 15 minutes.
 *   - Awards or points that land AFTER the watch has ended wait for the catch
 *     up, which runs the next time the district is watched (when any of its
 *     events is live or inside its own 24 hours), eight events per forced
 *     look. Until then the flag stays false, so the reservations stay held.
 *     The next offline republish resolves them too.
 *   - An event whose window is still open and whose published state says its
 *     playoffs are open is not asked for awards at all.
 *   - The flag's rule has two limits (quick task 261009-vp9). A FURTHER
 *     recipient of a consuming award type that is already listed (a second
 *     Impact at a championship, a fourth member of a winning alliance),
 *     listed more than an hour after the list last changed, lands after the
 *     flag is true. And an event that lists NONE of an expected award for 12
 *     unchanged hours and then lists it lands after the flag is true. Either
 *     is recorded on the tick its list changes, but the slot held for it was
 *     already released.
 *   - The first real district event to exercise this pass is the first one
 *     of 2027. Until then the replay over the eight 2026 PNW district events
 *     in `apps/worker/test/scheduled.district.test.ts` stands in for it.
 */
import { districtDetailKey, DistrictArtifactSchema, DistrictEventStateSchema, type DistrictArtifact, type DistrictEventState } from "../../../packages/harness/pageArtifacts.js";
import { applyDistrictEventState, applyDistrictRankings, type DistrictEventAwardInput } from "../../../packages/harness/districtRankingsMerge.js";
import { AWARDS_SETTLE_WITHOUT_IMPACT_MS, awardsListSettled } from "../../../packages/core/districts/eventAwards.js";
import { DISTRICT_KEY_PATTERN, EVENT_KEY_PATTERN } from "../../../packages/core/districts/keys.js";
import { districtRankingsCursorKey, eventAwardsCursorKey } from "../../../packages/harness/stateBaseline.js";
import { DISTRICT_AWARDS_WATCH_MS, type LiveWindowEntry } from "../../../packages/harness/manifestSchemas.js";
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

/** A watched district with nothing live is processed only on a tick whose UTC minute is a multiple of this (quick task 261009-tx6). */
export const DISTRICT_QUIET_CADENCE_MINUTES = 5;

/** On a tick whose UTC minute is a multiple of this, every processed district's rankings are asked with no ETag and the gate is passed unconditionally (quick task 261009-tx6). */
export const DISTRICT_FORCED_LOOK_MINUTES = 15;

/** The most older waiting events one district asks for their awards on one forced look (quick task 261009-tx6). */
export const DISTRICT_AWARDS_CATCH_UP_MAX = 8;

/** D1 allows 100 bound parameters per statement; 90 keys per read leaves headroom. The value `liveEventPass.ts` reads its cursors by, for the same reason. */
const CURSOR_READ_KEYS_PER_STATEMENT = 90;

/**
 * The windows handed in, grouped by the district each belongs to.
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
 * Districts are iterated in sorted key order so two ticks over the same set
 * do the same work in the same order.
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
  /** The districts the pass PROCESSED this tick: due on this tick's cadence, and left with at least one member once unproven calendar windows were dropped. Zero on a tick where no district is due. */
  readonly districtsConsidered: number;
  readonly districtsRefreshed: number;
  readonly districtsUnchanged: number;
  readonly districtsFailed: number;
}

const NO_DISTRICT_WORK: DistrictRefreshResult = { districtsConsidered: 0, districtsRefreshed: 0, districtsUnchanged: 0, districtsFailed: 0 };

export interface RunDistrictRefreshOptions {
  /** The windows the tick ACTUALLY processed — foldable plus promoted. Their events are the LIVE members, and a district with one runs every tick. Empty on the tick's two idle call sites. */
  readonly windows: readonly LiveWindowEntry[];
  /**
   * Every district window of the manifest that is live or ended within the
   * last `DISTRICT_AWARDS_WATCH_MS` (quick task 261009-tx6). An entry whose
   * event is not in `windows` is a WATCHED member: its district runs on the 5
   * minute cadence, and an `inferred` one needs proof of a played match.
   * Absent, the pass looks at `windows` alone, as it did before that task.
   */
  readonly watchWindows?: readonly LiveWindowEntry[];
  /**
   * Whether every live write is suspended this tick (a state generation
   * mismatch). Passed by the tick's idle call sites only. Called at most
   * once, after a district is due and proven and before any TBA request. True
   * or a throw: the pass does nothing and warns once.
   */
  readonly isSuspended?: () => Promise<boolean>;
  /** This tick's own per-event observations, filled by `processEvent` above the `newlyFolded.length === 0` return. An event absent from this map contributed no observation this tick (its match poll was a 304, it failed, or it is a watched member the tick did not process). */
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

/** True when a stored `lastAdvancedAt` is a time the settle clock can read. */
function hasUsableChangeTime(lastAdvancedAt: string | null): boolean {
  return lastAdvancedAt !== null && Number.isFinite(Date.parse(lastAdvancedAt));
}

/**
 * Whether a list in hand reads as CHANGED NOW against the awards cursor row
 * as it stood before this tick (quick task 261009-tx6): no row, a differing
 * ETag, or a list with an ETag beside a row with no usable change time. These
 * are exactly the cases in which the row is written, stamped with this tick's
 * time. See THE SETTLE CLOCK in this module's header.
 */
function awardsListChangedNow(stored: EventCursor | undefined, listEtag: string | null): boolean {
  if (stored === undefined) return true;
  if (stored.tbaEtag !== listEtag) return true;
  return listEtag !== null && !hasUsableChangeTime(stored.lastAdvancedAt);
}

/**
 * Named cursor rows, read `CURSOR_READ_KEYS_PER_STATEMENT` keys at a time and
 * counted one subrequest per statement. No key, no call and no spend.
 */
async function readCursorRows(db: Env["DB"], counter: SubrequestCounter, keys: readonly string[]): Promise<Map<string, EventCursor>> {
  const merged = new Map<string, EventCursor>();
  for (let start = 0; start < keys.length; start += CURSOR_READ_KEYS_PER_STATEMENT) {
    counter.spend(1);
    const chunk = await readEventCursors(db, keys.slice(start, start + CURSOR_READ_KEYS_PER_STATEMENT));
    for (const [key, cursor] of chunk) merged.set(key, cursor);
  }
  return merged;
}

/** One older event the catch up could ask about, with the week its rows carry. */
interface CatchUpCandidate {
  readonly eventKey: string;
  readonly week: number | null;
}

/**
 * The events the artifact's own rows say are still waiting for their awards
 * and that are not members this tick: any tier, District Championship
 * divisions included, a state block with `playoffsDone` true and
 * `awardsPosted` not true. A key that does not pass `EVENT_KEY_PATTERN` is
 * left out HERE, before it can become a D1 cursor key or a URL segment
 * (threat T-tx6-01): the artifact is read back from R2, and its event keys
 * are input like any other.
 *
 * A row that carries a state block wins over one that carries none, and the
 * week is the first row's, matching every other per event walk of a district
 * artifact.
 */
function catchUpCandidates(artifact: DistrictArtifact, memberEventKeys: ReadonlySet<string>): CatchUpCandidate[] {
  const byEvent = new Map<string, { state: DistrictEventState | undefined; week: number | null }>();
  for (const team of artifact.teams) {
    for (const row of [...team.eventPoints, ...team.remainingEvents]) {
      const known = byEvent.get(row.eventKey);
      if (known === undefined) byEvent.set(row.eventKey, { state: row.state, week: row.week });
      else if (known.state === undefined && row.state !== undefined) known.state = row.state;
    }
  }
  const candidates: CatchUpCandidate[] = [];
  for (const [eventKey, { state, week }] of byEvent) {
    if (state === undefined || !state.playoffsDone || state.awardsPosted) continue;
    if (memberEventKeys.has(eventKey) || !EVENT_KEY_PATTERN.test(eventKey)) continue;
    candidates.push({ eventKey, week });
  }
  return candidates;
}

/**
 * The catch up's order: an event never asked first (no row, or a row with no
 * usable `lastPolledAt`), then the one asked longest ago, ties by week
 * ascending with a null week last, then by event key. Every ask stamps
 * `lastPolledAt`, so the order rotates and an event that can never post
 * cannot keep a newer one from being asked (threat T-tx6-12).
 */
function orderCatchUp(candidates: readonly CatchUpCandidate[], cursors: ReadonlyMap<string, EventCursor>): CatchUpCandidate[] {
  const lastAskedMs = (eventKey: string): number => {
    const lastPolledAt = cursors.get(eventAwardsCursorKey(eventKey))?.lastPolledAt ?? null;
    const parsed = lastPolledAt === null ? Number.NaN : Date.parse(lastPolledAt);
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  };
  const weekRank = (week: number | null): number => (week === null ? Number.POSITIVE_INFINITY : week);
  return [...candidates].sort((a, b) => {
    const askedA = lastAskedMs(a.eventKey);
    const askedB = lastAskedMs(b.eventKey);
    if (askedA !== askedB) return askedA < askedB ? -1 : 1;
    const weekA = weekRank(a.week);
    const weekB = weekRank(b.week);
    if (weekA !== weekB) return weekA < weekB ? -1 : 1;
    return a.eventKey < b.eventKey ? -1 : a.eventKey > b.eventKey ? 1 : 0;
  });
}

/**
 * One tick's district pass. See this module's header for the never-throws
 * contract, the watch set, the two cadences, the two refusals, the order of
 * the steps and the reason for it.
 */
export async function runDistrictRefresh(env: Env, counter: SubrequestCounter, tbaCtx: TbaClientContext, options: RunDistrictRefreshOptions): Promise<DistrictRefreshResult> {
  const { windows, matchDerivedState, stamp, nowIso } = options;
  const nowMs = Date.parse(nowIso);

  // THE MEMBERS. The processed windows are live members. A watch window whose
  // event the tick did not process is a watched member, while it is inside
  // the watch: opened, and not yet `DISTRICT_AWARDS_WATCH_MS` past its close.
  // The tick's loader already selects by that bound; the pass applies it too,
  // by the same constant and the same half open comparison the offline
  // builder keeps a window by, so the rule holds whoever calls it.
  const liveEventKeys = new Set(windows.map((window) => window.eventKey));
  const memberEventKeys = new Set(liveEventKeys);
  const watchedOnly: LiveWindowEntry[] = [];
  for (const window of options.watchWindows ?? []) {
    if (memberEventKeys.has(window.eventKey)) continue;
    if (!(window.startMs <= nowMs && nowMs < window.endMs + DISTRICT_AWARDS_WATCH_MS)) continue;
    memberEventKeys.add(window.eventKey);
    watchedOnly.push(window);
  }
  const districts = liveDistrictsOf([...windows, ...watchedOnly]);
  if (districts.size === 0) return NO_DISTRICT_WORK;

  // THE CADENCE, off the UTC minute of the tick. An unparseable clock is no
  // mark at all, which leaves only the districts with a live member.
  const minute = Number.isFinite(nowMs) ? new Date(nowMs).getUTCMinutes() : Number.NaN;
  const forcedLook = minute % DISTRICT_FORCED_LOOK_MINUTES === 0;
  const quietMark = minute % DISTRICT_QUIET_CADENCE_MINUTES === 0;
  const due = new Map<string, LiveWindowEntry[]>();
  for (const [districtKey, members] of districts) {
    if (quietMark || members.some((member) => liveEventKeys.has(member.eventKey))) due.set(districtKey, members);
  }
  // No district is due: NOTHING is spent. No D1 read, no request.
  if (due.size === 0) return NO_DISTRICT_WORK;

  // A watched member on a calendar window has to prove a played match.
  const needsProof = (member: LiveWindowEntry): boolean => member.inferred && !liveEventKeys.has(member.eventKey);

  // THE ONE CURSOR READ, for due districts only: every district's rankings
  // key, every member's awards key, and the plain match cursor key of every
  // member that needs proof. One subrequest per statement of 90 keys, so
  // knowing which events have an awards cursor row, and what each holds,
  // never costs a round trip per event. Inside a try: this is the first I/O
  // of the pass, and the pass never throws.
  const cursorKeys: string[] = [];
  for (const [districtKey, members] of due) {
    cursorKeys.push(districtRankingsCursorKey(districtKey));
    for (const member of members) {
      cursorKeys.push(eventAwardsCursorKey(member.eventKey));
      if (needsProof(member)) cursorKeys.push(member.eventKey);
    }
  }
  let cursors: Map<string, EventCursor>;
  try {
    cursors = await readCursorRows(env.DB, counter, cursorKeys);
  } catch (err) {
    console.warn(JSON.stringify({ msg: "district-cursor-read-failed", districts: due.size, error: err instanceof Error ? err.message : String(err) }));
    return { districtsConsidered: due.size, districtsRefreshed: 0, districtsUnchanged: 0, districtsFailed: due.size };
  }

  // THE PROOF. An unproven calendar window is dropped, and a district left
  // with no member is not processed: it has cost its share of the one read
  // above and no district request.
  const proven = new Map<string, LiveWindowEntry[]>();
  for (const [districtKey, members] of due) {
    const kept = members.filter((member) => !needsProof(member) || (cursors.get(member.eventKey)?.lastFoldedMatchKey ?? null) !== null);
    if (kept.length > 0) proven.set(districtKey, kept);
  }
  if (proven.size === 0) return NO_DISTRICT_WORK;

  // THE SUSPENSION CHECK, once, before any TBA request. Only the idle call
  // sites pass one: the main call site sits below the mismatch return.
  if (options.isSuspended !== undefined) {
    let suspended = true;
    let reason: string | undefined;
    try {
      suspended = await options.isSuspended();
    } catch (err) {
      reason = err instanceof Error ? err.message : String(err);
    }
    if (suspended) {
      console.warn(JSON.stringify({ msg: "district-pass-suspended", districts: proven.size, ...(reason === undefined ? {} : { error: reason }) }));
      return NO_DISTRICT_WORK;
    }
  }

  let districtsRefreshed = 0;
  let districtsUnchanged = 0;
  let districtsFailed = 0;

  for (const [districtKey, memberWindows] of proven) {
    try {
      if (!DISTRICT_KEY_PATTERN.test(districtKey)) {
        districtsFailed++;
        console.warn(JSON.stringify({ msg: "district-key-rejected", districtKey }));
        continue;
      }

      const cursorKey = districtRankingsCursorKey(districtKey);
      const cursor = cursors.get(cursorKey) ?? emptyCursor(cursorKey);

      // STEP 1. The rankings request comes FIRST, before any R2 read. On a
      // forced look it carries no ETag, so TBA answers with the whole body
      // and the merge below runs against whatever R2 holds now.
      counter.spend(1);
      const poll = await pollDistrictRankings(tbaCtx, districtKey, forcedLook ? undefined : (cursor.tbaEtag ?? undefined));

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

      // STEP 2. Every member event, live or watched, that HAS an awards
      // cursor row is asked conditionally, before any R2 read. A row with a
      // null ETag (a retry marker, or a response that carried no ETag) is
      // asked with none.
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
      // A FORCED LOOK PASSES IT UNCONDITIONALLY.
      const observedAny = memberWindows.some((entry) => matchDerivedState.has(entry.eventKey));
      const awardsListChanged = awardsInHand.size > 0;
      if (!forcedLook && poll.status === "not-modified" && !observedAny && !awardsListChanged) {
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

      // STEP 5, THE CATCH UP, on a forced look only: the older waiting events
      // the artifact names, their rows read in one counted D1 read, and at
      // most eight of them chosen. Their rows join the pass's own map, keyed
      // by their awards cursor key, so the settle clock and the cursor writes
      // below read them exactly as they read a member's.
      const catchUpEventKeys: string[] = [];
      if (forcedLook) {
        const districtMemberKeys = new Set(memberWindows.map((entry) => entry.eventKey));
        const candidates = catchUpCandidates(existing, districtMemberKeys);
        if (candidates.length > 0) {
          const rows = await readCursorRows(
            env.DB,
            counter,
            candidates.map((candidate) => eventAwardsCursorKey(candidate.eventKey))
          );
          for (const [key, row] of rows) cursors.set(key, row);
          for (const candidate of orderCatchUp(candidates, cursors).slice(0, DISTRICT_AWARDS_CATCH_UP_MAX)) catchUpEventKeys.push(candidate.eventKey);
        }
      }
      const catchUpSet = new Set(catchUpEventKeys);

      // STEP 6. The five-field state map, one entry per member event this
      // pass can say something honest about, and beside it the awards lists
      // the merge will read.
      const eventState = new Map<string, DistrictEventState>();
      const eventAwards = new Map<string, readonly DistrictEventAwardInput[]>();
      // The events of `eventAwards` whose list has stood unchanged for an
      // hour, read from each cursor row as it stood before this tick.
      const settledAwardEvents = new Set<string>();
      // The same question at 12 hours (quick task 261009-vp9), from the same
      // row: the wait for a list that lacks an award its event gives. This
      // pass only measures both lengths. The merge decides which one counts.
      const longSettledAwardEvents = new Set<string>();
      // Events whose awards ask failed this tick while their flag still waits:
      // each gets a null ETag retry marker at the end.
      const retryMarkerEvents: string[] = [];

      /** Hands a list in hand to the merge, and names the event settled, at each of the two lengths, when its cursor row says so. */
      const handToMerge = (eventKey: string): void => {
        const inHand = awardsInHand.get(eventKey);
        if (inHand === undefined) return;
        eventAwards.set(eventKey, inHand.awards);
        const storedAwards = cursors.get(eventAwardsCursorKey(eventKey));
        if (awardsListSettled(storedAwards?.tbaEtag, storedAwards?.lastAdvancedAt, inHand.etag, nowMs)) settledAwardEvents.add(eventKey);
        if (awardsListSettled(storedAwards?.tbaEtag, storedAwards?.lastAdvancedAt, inHand.etag, nowMs, AWARDS_SETTLE_WITHOUT_IMPACT_MS)) longSettledAwardEvents.add(eventKey);
      };

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
          // THE UNCONDITIONAL ASK, in three cases.
          //
          // The flag still waits, and either a 304 in step 2 carried no list
          // or the event has no row and has never been asked. Either way the
          // rule needs the list in hand to be read against the rankings
          // merged this tick. That much is common to the first two cases.
          const waitingWithNoList = !carriedFlag && (awardsNotModified.has(eventKey) || !hasAwardsRow);
          // First: the playoffs are done. While they are not, an award cannot
          // have been given out, so an event still in play is not asked.
          const playoffsDone = matchDerived.playoffsDone;
          // Second, ON A FORCED LOOK ONLY: the event's window has ENDED,
          // whatever its published state says about the playoffs. Playoffs
          // that ran past the measured window leave `playoffsDone` false with
          // nothing left to observe it, and that event would otherwise never
          // be asked. A member whose window is still open is never asked on
          // this ground.
          const endedOnForcedLook = forcedLook && entry.endMs <= nowMs;
          // Third: the flag is already true and the event has no row. The
          // offline publisher set it, so the Worker has never asked. One ask
          // gives the event a row, and from then on a changed list passes the
          // gate. A flag already true with a 304 in step 2 needs nothing.
          const neverAsked = carriedFlag && !hasAwardsRow;
          if ((waitingWithNoList && (playoffsDone || endedOnForcedLook)) || neverAsked) await askAwards(eventKey, undefined);
        }

        eventState.set(eventKey, DistrictEventStateSchema.parse({ ...matchDerived, awardsPosted: carriedFlag }));

        // EVERY list in hand is merged, whether or not the flag turns true
        // this tick: a winner is recorded as soon as TBA lists it.
        handToMerge(eventKey);
        if (awardsFailed.has(eventKey) && !carriedFlag) retryMarkerEvents.push(eventKey);
      }

      // The catch up events: each asked ONCE, with no ETag. Nothing is said
      // about their state (nothing was observed), so they are not in the
      // state map: the merge raises a flag on the rows the artifact already
      // carries, from the list and the settled set alone.
      for (const eventKey of catchUpEventKeys) {
        await askAwards(eventKey, undefined);
        handToMerge(eventKey);
        if (awardsFailed.has(eventKey)) retryMarkerEvents.push(eventKey);
      }

      // STEP 7. Build the candidate ONCE, with the EXISTING artifact's own
      // stamp held constant, so the comparison below measures CONTENT and not
      // the clock. The flag, the winner records and both lock verdicts come
      // out of this one build.
      const candidate =
        poll.status === "ok"
          ? applyDistrictRankings({ artifact: existing, rankings: poll.body, generation: existing.generation, computedAt: existing.computedAt, eventState, eventAwards, settledAwardEvents, longSettledAwardEvents })
          : applyDistrictEventState({ artifact: existing, eventState, eventAwards, settledAwardEvents, longSettledAwardEvents, generation: existing.generation, computedAt: existing.computedAt });

      // STEP 8. The awards cursor rows this tick earned, decided now and
      // written last. A member's row is written only when its list reads as
      // changed now, so a quiet waiting event costs no D1 write and its
      // settle clock keeps running. A CATCH UP event's row is ALWAYS written,
      // with `lastPolledAt` set to this tick, so the catch up's order rotates.
      const awardsCursorWrites: EventCursor[] = [];
      const written = new Set<string>();
      for (const eventKey of eventAwards.keys()) {
        // The ETag of the list the merge just read, whatever the flag says and
        // whatever the list holds, and this tick's time as the moment that
        // ETag last changed. A response with no ETag stores a null.
        const awardsKey = eventAwardsCursorKey(eventKey);
        const stored = cursors.get(awardsKey);
        const etag = awardsInHand.get(eventKey)!.etag;
        if (awardsListChangedNow(stored, etag)) {
          awardsCursorWrites.push({ ...(stored ?? emptyCursor(awardsKey)), tbaEtag: etag, lastPolledAt: nowIso, lastAdvancedAt: nowIso });
          written.add(eventKey);
        }
      }
      for (const eventKey of retryMarkerEvents) {
        // THE RETRY MARKER: a null ETag, never an ETag from the failed
        // response, created if the row is absent. The next ask carries no
        // ETag, and the list it brings reads as changed now.
        const awardsKey = eventAwardsCursorKey(eventKey);
        const stored = cursors.get(awardsKey);
        if (stored === undefined || stored.tbaEtag !== null || catchUpSet.has(eventKey)) {
          awardsCursorWrites.push({ ...(stored ?? emptyCursor(awardsKey)), tbaEtag: null, lastPolledAt: nowIso });
          written.add(eventKey);
        }
      }
      for (const eventKey of catchUpEventKeys) {
        // Asked, and its list is the one already stored: the ETag and the
        // change time stand, and only the time it was asked moves.
        if (written.has(eventKey)) continue;
        const awardsKey = eventAwardsCursorKey(eventKey);
        awardsCursorWrites.push({ ...(cursors.get(awardsKey) ?? emptyCursor(awardsKey)), lastPolledAt: nowIso });
      }

      // ETag cursors are written LAST, and only once nothing further can fail
      // for this district. Caching an ETag before a put that then rejects would
      // hand the next tick a 304 and leave the stale artifact in place until
      // the next forced look — the write is what earns the right to stop
      // asking.
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

  return { districtsConsidered: proven.size, districtsRefreshed, districtsUnchanged, districtsFailed };
}
