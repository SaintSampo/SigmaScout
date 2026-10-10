/**
 * The live districts guard of the offline district publisher (quick task 261010-jyn).
 *
 * WHAT IT PROTECTS. The Worker owns `v1/district/{districtKey}.json` while one
 * of that district's events is live and for 24 hours after it: it merges
 * rankings, records award winners and decides, by its own live rule, when an
 * event's awards are posted. `scripts/publishDistricts.ts` rebuilds the same
 * object from the corpus, sets the awards flag at its hindsight vantage and
 * writes the corpus's points snapshot, which is older than what the Worker has
 * merged. Either can take back a lock the page already showed. So while the
 * Worker owns a district's file, the publisher leaves that district alone.
 *
 * A LIVE DISTRICT IS SKIPPED, NEVER A REASON TO REFUSE THE RUN. In season one
 * district or another is live for days at a stretch, so a whole run refusal
 * would be overridden as a matter of routine. A skipped district uploads
 * nothing (no detail file, no sidecar), gets no local file, and is neither
 * read nor compared by the 261009-ul3 guard. Every other district of the run
 * publishes as before.
 *
 * WHERE THE WINDOW COMES FROM. `buildLiveWindowsManifest`
 * (`packages/harness/manifests.ts`), the same function the live windows
 * manifest is built with, asked on the same corpus at the clock. It gives an
 * event a window from its match times, or from its start date when the corpus
 * holds no match for it, and it keeps a district event's window until 24
 * hours after it closed (`DISTRICT_AWARDS_WATCH_MS`). This module writes no
 * window bound, no pad, no calendar span and no retention bound of its own.
 *
 * THE ONE COMPARISON IT ADDS, AND WHY. The builder keeps every window that has
 * not opened yet, because a manifest has to name the events still to come. So
 * "kept by the builder at the clock" is only half of "live". The other half is
 * `window.startMs <= nowMs`, added here. Together they are the Worker's own
 * comparison (`apps/worker/src/districtRefresh.ts`): a district member is
 * watched while `startMs <= now && now < endMs + DISTRICT_AWARDS_WATCH_MS`.
 *
 * MEMBERSHIP IS THE MANIFEST'S `districtKey`, AND NO EVENT TYPE IS TESTED. An
 * event belongs to a district exactly when its `events.district_key` joins a
 * `districts` row of its year, which is how the builder fills `districtKey`
 * and how the publisher lists a district's events. In the corpus that set is
 * district events, District Championships and their divisions, and nothing
 * else: no offseason event carries a district key. A second membership rule
 * here could disagree with the Worker, so there is none.
 *
 * WHY A SKIPPED DISTRICT'S INDEX ROW IS THE PUBLISHED ONE. The Worker never
 * writes `v1/districts/{year}.json`. But a row composed from today's corpus
 * can contradict the detail file the Worker owns: the Worker's merge sets the
 * detail's team count to its own team list and keeps the slot counts and the
 * event count as last published, while a composed row takes all four from the
 * corpus. So the index a season uploads keeps the row that is published now
 * for every district the run skips. A published index that is missing,
 * unreadable or not a districts index refuses the run before any upload:
 * there is no row to keep, and a composed one is the row this rule exists to
 * hold back.
 *
 * AN EVENT THE BUILDER CAN GIVE NO WINDOW IS LIVE IN ITS OWN YEAR, IN DOUBT.
 * The builder gives an event no window only when the corpus holds no match
 * for it and its start date does not parse. Nothing can then say when it
 * runs, so it makes its district live for as long as the clock's UTC year is
 * the district's season, and never in another year. No such event is in the
 * corpus today (every one of its district events has a start date that
 * parses), so this rule is unreachable until one appears.
 *
 * WHY THE BUILDER IS ASKED TWICE. An event missing from the builder's answer
 * at the clock is either past its watch, and pruned, or one it can give no
 * window at all, and the answer does not say which. So the builder is asked a
 * second time with retention switched off: an event absent there too has no
 * window, and an event present there is merely past its watch and is not live.
 *
 * THE EVIDENCE RULE, AND WHY THE CLOCK RULE IS NOT ENOUGH. The Worker does
 * not rebuild the windows. It reads the manifest object that was published
 * earlier, built from the corpus as it was then. When that manifest was built
 * before an event's schedule existed, it holds the event's CALENDAR window,
 * and the corpus now holds its matches, so the clock rule reads the shorter
 * window from the match times. Measured 2026-10-10 on the 148 district events
 * of 2026 that have matches, the calendar window stays open a median 25 hours
 * after the match window closes (74 at most). In that time the Worker can still be
 * watching a district the clock rule no longer lists. By then the live rule
 * has normally turned the awards flag true and the points are normally final,
 * but that is TBA's timing and nothing in the code guarantees it. So for an
 * event still inside its calendar window plus 24 hours, the publisher compares
 * what it is about to upload with the published file it has just read for the
 * 261009-ul3 guard, and skips the district on either of two differences.
 *
 * WHICH WINDOW, AND WHY THE TWO RULES TOGETHER ARE THE UNION. The Worker's
 * manifest can hold either of the builder's two windows for an event,
 * depending on whether the corpus held its matches when that manifest was
 * built. The clock rule is the match window half (and the calendar window of
 * an event with no match). The evidence rule is the calendar half for an
 * event that has matches: `calendarWatchEventsAt` asks the builder's own
 * `probeWindowFor` with the clock moved back by the watch, exactly as the
 * builder asks it for a district event, and writes no bound of its own. A
 * district the clock rule listed is not looked at again.
 *
 * THE TWO DIFFERENCES. (i) This run would write `awardsPosted` true for the
 * event where the published file does not hold it true. Not true is three
 * cases, each of them "the Worker has not confirmed it": false, no state on
 * any row of the event, and no row for the event at all. (ii) This run would
 * write a lower value than the published one in `qual`, `alliance`, `elim`,
 * `award` or `total` of an `eventPoints` row both files hold: a snapshot
 * older than what the Worker has merged. A higher value, a row only one side
 * holds, and anything at an event outside that window are not evidence.
 * Outside the window nothing changes: an older event's flag is still raised
 * at the hindsight vantage, and a lower value there is still not a regression.
 *
 * THE FOLD IS THE 261009-ul3 MODULE'S OWN RULE, STATED AGAIN, because that
 * module's event fold is not exported and that file is not edited here. A
 * flag is true for an event when any `eventPoints` or `remainingEvents` row
 * of it carries a state with it true, and a team's first `eventPoints` row at
 * the event is its row.
 *
 * WHAT THE EVIDENCE RULE DOES NOT COMPARE. A district the clock rule listed.
 * A district with no event in a calendar window plus 24 hours. A published
 * body that is `null` (a first publish), was not read, is not JSON or is not
 * a district artifact (a shape change). It reads nothing, it never throws,
 * and it never changes what the 261009-ul3 guard refuses: that guard runs
 * first, on the same districts, exactly as before.
 *
 * THE OVERRIDE, THE NOTICE AND THE CHECK THAT CANNOT RUN. `--allow-live`
 * prints the same event lines and one override line, and the run publishes
 * the listed districts too. A `--dry-run` uploads nothing, so it prints the
 * same event lines as a notice, skips nothing and never fails. A check that
 * cannot run (the windows cannot be built) refuses a run that uploads, with or
 * without the override, because a run that cannot tell whether a district is
 * live must not write over it. In a dry run it is one printed line.
 *
 * This module never reads the wall clock or the environment. The clock, the
 * corpus handle, the reader and the logger are handed in, so every test runs
 * without a network.
 */
import type { Corpus } from "../packages/corpus/db.js";
import { buildLiveWindowsManifest, DISTRICT_AWARDS_WATCH_MS, probeWindowFor } from "../packages/harness/manifests.js";
import { DistrictArtifactSchema, DistrictsIndexArtifactSchema, type DistrictArtifact, type DistrictsIndexArtifact } from "../packages/harness/pageArtifacts.js";
import { DistrictPublishRefusedError, type PublishedReader } from "./districtPublishGuard.js";

/** Every line this module logs, and every message it throws, contains this text. */
export const LIVE_DISTRICT_MARKER = "live district";

/** The `generation` handed to the builder. A label only: the manifest it stamps is read for its windows and thrown away, never published. */
const LIVE_GUARD_GENERATION = "district-live-guard-not-published";

/**
 * The retention clock that switches the builder's retention OFF. The builder
 * drops a window once `endMs <= nowMs` (24 hours later for a district event),
 * and its own doc of `nowMs` names this idiom: a caller passes `nowMs: 0` to
 * keep every window "in the future". Asked with it, the builder lists every
 * event it can give a window at all.
 */
const RETENTION_OFF_NOW_MS = 0;

export interface RunDistrictEvent {
  readonly eventKey: string;
  /** TBA's YYYY-MM-DD, as the corpus holds it. `null` where the corpus holds none. */
  readonly startDate: string | null;
}

/** One district of the run, with every event the publisher lists for it. */
export interface RunDistrict {
  /** TBA's year prefixed key, `"2026pnw"`. */
  readonly districtKey: string;
  readonly season: number;
  readonly events: readonly RunDistrictEvent[];
}

// ---------------------------------------------------------------------------
// The clock rule
// ---------------------------------------------------------------------------

export interface LiveDistrictEvent {
  readonly districtKey: string;
  readonly eventKey: string;
  /** `matches`: the window is from the event's match times. `calendar`: from its start date, the corpus holds no match for it. `no-window`: the builder can give it none. */
  readonly basis: "matches" | "calendar" | "no-window";
  /** The builder's own bounds, `null` for `no-window`. */
  readonly startMs: number | null;
  readonly endMs: number | null;
  /** `endMs + DISTRICT_AWARDS_WATCH_MS`, for printing. */
  readonly watchedUntilMs: number | null;
}

function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Every event that makes a district of the run live at `nowMs`, sorted by
 * district key, then event key. Reads the corpus and writes nothing.
 *
 * The builder is asked AT the clock, so its own retention decides "past the
 * watch". The one comparison added is `startMs <= nowMs`: see the header.
 *
 * It is asked a second time with retention off, to tell an event past its
 * watch from an event it can give no window. The second kind makes its
 * district live only when the district's season is the clock's UTC year.
 */
export function liveDistrictEventsAt(db: Corpus, args: { readonly districts: readonly RunDistrict[]; readonly nowMs: number }): LiveDistrictEvent[] {
  const { districts, nowMs } = args;
  if (!Number.isFinite(nowMs)) {
    throw new Error(`districtLiveGuard: the clock (${String(nowMs)}) is not a finite number of milliseconds, so no district can be read as live or as not live`);
  }
  if (districts.length === 0) return [];

  const runDistrictKeys = new Set(districts.map((district) => district.districtKey));
  const seasons = [...new Set(districts.map((district) => district.season))].sort((a, b) => a - b);
  const manifest = buildLiveWindowsManifest(db, { seasons, generation: LIVE_GUARD_GENERATION, computedAt: new Date(nowMs).toISOString(), nowMs });

  const live: LiveDistrictEvent[] = [];
  for (const window of manifest.windows) {
    // Membership is the manifest's own `districtKey`. A null key is not a
    // district event, and a key outside the run is not this run's business.
    if (typeof window.districtKey !== "string" || !runDistrictKeys.has(window.districtKey)) continue;
    // The builder also keeps windows that have not opened yet.
    if (!(window.startMs <= nowMs)) continue;
    live.push({
      districtKey: window.districtKey,
      eventKey: window.eventKey,
      basis: window.inferred ? "calendar" : "matches",
      startMs: window.startMs,
      endMs: window.endMs,
      watchedUntilMs: window.endMs + DISTRICT_AWARDS_WATCH_MS,
    });
  }

  // The event with no window at all. Only a district of the clock's own UTC
  // year can be made live by one, so the second call is skipped otherwise.
  const clockYear = new Date(nowMs).getUTCFullYear();
  const inDoubt = districts.filter((district) => district.season === clockYear);
  if (inDoubt.length > 0) {
    const everything = buildLiveWindowsManifest(db, {
      seasons,
      generation: LIVE_GUARD_GENERATION,
      computedAt: new Date(nowMs).toISOString(),
      nowMs: RETENTION_OFF_NOW_MS,
    });
    // By event key alone: an event the builder gives a window is not in doubt,
    // whatever district key that window carries.
    const hasWindow = new Set(everything.windows.map((window) => window.eventKey));
    for (const district of inDoubt) {
      for (const event of district.events) {
        if (hasWindow.has(event.eventKey)) continue;
        live.push({ districtKey: district.districtKey, eventKey: event.eventKey, basis: "no-window", startMs: null, endMs: null, watchedUntilMs: null });
      }
    }
  }
  return live.sort((a, b) => byText(a.districtKey, b.districtKey) || byText(a.eventKey, b.eventKey));
}

function instant(ms: number | null): string {
  return ms === null ? "none" : new Date(ms).toISOString();
}

function liveEventLine(event: LiveDistrictEvent): string {
  if (event.basis === "no-window") {
    return (
      `publishDistricts: ${LIVE_DISTRICT_MARKER} ${event.districtKey}: event ${event.eventKey} has no match and no usable start date in the corpus, so no window can be built for it. Its season is the current year, so it is read as live.`
    );
  }
  const source = event.basis === "matches" ? "from its match times" : "from its start date, the corpus holds no match for it";
  return (
    `publishDistricts: ${LIVE_DISTRICT_MARKER} ${event.districtKey}: event ${event.eventKey} is inside its window or within 24 hours after it. ` +
    `Window ${instant(event.startMs)} to ${instant(event.endMs)}, ${source}. The Worker watches it until ${instant(event.watchedUntilMs)}.`
  );
}

export interface LiveDistrictsCheck {
  /** The live events of districts not in `alreadyListed`. */
  readonly live: readonly LiveDistrictEvent[];
  /** Their distinct district keys, sorted. */
  readonly liveDistrictKeys: readonly string[];
  /** `true` only in `enforce` mode with `allowLive` and something live. */
  readonly overridden: boolean;
  /** `true` only in `notice` mode when the check could not run. */
  readonly unchecked: boolean;
}

/**
 * The clock check of one pass: prints what it finds and returns it. A live
 * district is never a reason to throw: it throws only when the check cannot
 * run on a run that uploads. The event lines come first, one per live event
 * in sorted order, and nothing at all is printed when nothing is live.
 *
 * | mode    | allowLive | the windows cannot be built            | live events found                                    |
 * |---------|-----------|----------------------------------------|------------------------------------------------------|
 * | enforce | false     | throws, naming the error               | event lines, one skip line per district              |
 * | enforce | true      | the same throw                         | event lines, one override line, `overridden: true`   |
 * | notice  | ignored   | one line naming the error, `unchecked` | event lines, one notice line                         |
 *
 * Every throw is a `DistrictPublishRefusedError`. In every row the district
 * keys come back: the caller decides what a key means for its run.
 */
export function checkLiveDistricts(args: {
  /** Printed: "before the bake" or "before the first upload". */
  readonly stage: string;
  readonly db: Corpus;
  readonly districts: readonly RunDistrict[];
  readonly nowMs: number;
  readonly log: (line: string) => void;
  /** District keys an earlier pass printed: neither printed nor returned again. */
  readonly alreadyListed?: ReadonlySet<string>;
  readonly mode: "enforce" | "notice";
  readonly allowLive: boolean;
}): LiveDistrictsCheck {
  const alreadyListed = args.alreadyListed ?? new Set<string>();
  let everyLiveEvent: LiveDistrictEvent[];
  try {
    everyLiveEvent = liveDistrictEventsAt(args.db, { districts: args.districts, nowMs: args.nowMs });
  } catch (cause) {
    // The message only: never the error object or a stack.
    const message = cause instanceof Error ? cause.message : String(cause);
    if (args.mode === "notice") {
      args.log(`publishDistricts: the ${LIVE_DISTRICT_MARKER} check could not run ${args.stage}: ${message}. A dry run goes on.`);
      return { live: [], liveDistrictKeys: [], overridden: false, unchecked: true };
    }
    throw new DistrictPublishRefusedError(
      `publishDistricts: refused ${args.stage}. Nothing was uploaded. The ${LIVE_DISTRICT_MARKER} check could not run: ${message}. ` +
        `A run that cannot tell whether a district is live does not publish, and --allow-live does not change that.`
    );
  }
  const live = everyLiveEvent.filter((event) => !alreadyListed.has(event.districtKey));
  const liveDistrictKeys = [...new Set(live.map((event) => event.districtKey))].sort(byText);
  if (live.length === 0) return { live, liveDistrictKeys, overridden: false, unchecked: false };

  for (const event of live) args.log(liveEventLine(event));
  if (args.mode === "notice") {
    args.log(
      `publishDistricts: --dry-run uploads nothing, so this is a notice. A run that uploads would skip the ${liveDistrictKeys.length} ${LIVE_DISTRICT_MARKER}(s) listed above, unless --allow-live is given.`
    );
    return { live, liveDistrictKeys, overridden: false, unchecked: false };
  }
  if (args.allowLive) {
    args.log(`publishDistricts: --allow-live was given, so this run publishes the ${liveDistrictKeys.length} ${LIVE_DISTRICT_MARKER}(s) listed above too.`);
    return { live, liveDistrictKeys, overridden: true, unchecked: false };
  }
  for (const districtKey of liveDistrictKeys) {
    args.log(
      `publishDistricts: ${LIVE_DISTRICT_MARKER} ${districtKey} is skipped ${args.stage}: this run uploads nothing of it, and its published file stays as the Worker has it.`
    );
  }
  return { live, liveDistrictKeys, overridden: false, unchecked: false };
}

// ---------------------------------------------------------------------------
// What a season uploads, and the index that keeps a skipped district's row
// ---------------------------------------------------------------------------

/**
 * What one season uploads once the skipped districts are known. The index is
 * this run's when nothing of the season is skipped, the carried one when some
 * districts are skipped and some are not, and none when every district is
 * skipped: then nothing of the season is uploaded at all.
 */
export function seasonUploadPlan(args: {
  /** The season's districts, in composed order. */
  readonly districtKeys: readonly string[];
  readonly skipped: ReadonlySet<string>;
}): {
  readonly publish: readonly string[];
  readonly skip: readonly string[];
  readonly index: "composed" | "carried" | "none";
} {
  const publish = args.districtKeys.filter((districtKey) => !args.skipped.has(districtKey));
  const skip = args.districtKeys.filter((districtKey) => args.skipped.has(districtKey));
  const index = skip.length === 0 ? "composed" : publish.length === 0 ? "none" : "carried";
  return { publish, skip, index };
}

/**
 * The index a season with skipped districts uploads: this run's rows in this
 * run's order, with each skipped district's row replaced by the row of the
 * same key in the index that is published now. One read of `indexKey`.
 *
 * | the reader                                             | result                                        |
 * |--------------------------------------------------------|-----------------------------------------------|
 * | throws                                                 | refuses, naming the key and the error message |
 * | answers `null` (no object)                             | refuses, naming the key                       |
 * | answers a body that is not a districts index           | refuses, naming the key                       |
 * | answers the districts index of another year            | refuses, naming the key and that year         |
 * | answers the season's districts index                   | the carried index                             |
 *
 * Every refusal is a `DistrictPublishRefusedError`. A skipped district with no
 * published row is left out, with one line: the index goes on saying what is
 * published. A row of a district that is not skipped is this run's, even where
 * the published row differs. The stamps and the year are this run's, though a
 * carried row is older: the rows hold no stamp of their own.
 */
export async function carryPublishedIndex(args: {
  readonly bucket: string;
  /** `"v1/districts/2026.json"`. */
  readonly indexKey: string;
  readonly season: number;
  /** This run's index. */
  readonly composed: DistrictsIndexArtifact;
  readonly skipped: ReadonlySet<string>;
  readonly read: PublishedReader;
  readonly log: (line: string) => void;
}): Promise<DistrictsIndexArtifact> {
  const skippedHere = args.composed.districts.filter((row) => args.skipped.has(row.districtKey)).map((row) => row.districtKey);
  const refuse = (reason: string): DistrictPublishRefusedError =>
    new DistrictPublishRefusedError(
      `publishDistricts: refused before the first upload. Nothing was uploaded. This run skips ${skippedHere.length} ${LIVE_DISTRICT_MARKER}(s) of season ${args.season} ` +
        `and has to keep their rows from the published "${args.indexKey}", and ${reason}. ` +
        `Run this again once no district of that season is skipped, or pass --allow-live, which publishes them too.`
    );

  let body: string | null;
  try {
    body = await args.read(args.bucket, args.indexKey);
  } catch (cause) {
    // The message only: never the error object or a stack.
    throw refuse(`it could not be read: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (body === null) throw refuse("that object does not exist");

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(body);
  } catch {
    throw refuse("it is not a districts index");
  }
  const parsed = DistrictsIndexArtifactSchema.safeParse(parsedJson);
  if (!parsed.success) throw refuse("it is not a districts index");
  if (parsed.data.year !== args.season) throw refuse(`it is the districts index of year ${parsed.data.year}`);

  const publishedRows = new Map(parsed.data.districts.map((row) => [row.districtKey, row] as const));
  const kept: string[] = [];
  const missing: string[] = [];
  const districts: DistrictsIndexArtifact["districts"] = [];
  for (const row of args.composed.districts) {
    if (!args.skipped.has(row.districtKey)) {
      districts.push(row);
      continue;
    }
    const published = publishedRows.get(row.districtKey);
    if (published === undefined) {
      missing.push(row.districtKey);
      continue;
    }
    kept.push(row.districtKey);
    districts.push(published);
  }

  if (kept.length > 0) {
    args.log(`publishDistricts: "${args.indexKey}" keeps the published row of ${kept.length} ${LIVE_DISTRICT_MARKER}(s) this run skips: ${kept.join(", ")}.`);
  }
  for (const districtKey of missing) {
    args.log(`publishDistricts: ${LIVE_DISTRICT_MARKER} ${districtKey} has no row in the published "${args.indexKey}", so the index this run uploads leaves it out.`);
  }
  return DistrictsIndexArtifactSchema.parse({ ...args.composed, districts });
}

// ---------------------------------------------------------------------------
// The evidence rule
// ---------------------------------------------------------------------------

export interface CalendarWatchEvent {
  readonly eventKey: string;
  /** `probeWindowFor`'s own bounds. */
  readonly startMs: number;
  readonly endMs: number;
  /** `endMs + DISTRICT_AWARDS_WATCH_MS`. */
  readonly watchedUntilMs: number;
}

/**
 * Per district, the events whose CALENDAR window plus 24 hours is open at the
 * clock. No corpus read: start dates only. The map holds only the districts
 * with at least one such event, in the order they were handed in, and each
 * district's events are sorted by key.
 *
 * The window is `probeWindowFor`'s, asked with the clock moved back by
 * `DISTRICT_AWARDS_WATCH_MS`, which is exactly how the builder asks it for a
 * district event. The one comparison added is the same as the clock rule's:
 * the window has opened. An event whose start date is `null` or does not
 * parse has no calendar window and is never returned.
 */
export function calendarWatchEventsAt(args: {
  readonly districts: readonly RunDistrict[];
  readonly nowMs: number;
  /** District keys the clock rule already listed. */
  readonly exclude?: ReadonlySet<string>;
}): Map<string, CalendarWatchEvent[]> {
  const watched = new Map<string, CalendarWatchEvent[]>();
  for (const district of args.districts) {
    if (args.exclude?.has(district.districtKey) === true) continue;
    const events: CalendarWatchEvent[] = [];
    for (const event of district.events) {
      if (event.startDate === null) continue;
      const probe = probeWindowFor(event.startDate, args.nowMs - DISTRICT_AWARDS_WATCH_MS);
      if (probe === undefined) continue;
      if (!(probe.startMs <= args.nowMs)) continue;
      events.push({ eventKey: event.eventKey, startMs: probe.startMs, endMs: probe.endMs, watchedUntilMs: probe.endMs + DISTRICT_AWARDS_WATCH_MS });
    }
    if (events.length > 0) watched.set(district.districtKey, events.sort((a, b) => byText(a.eventKey, b.eventKey)));
  }
  return watched;
}

/** The five numbers of an `eventPoints` row, in the order a lowered value is reported. */
export const EVIDENCE_POINT_CATEGORIES = ["qual", "alliance", "elim", "award", "total"] as const;

export interface LiveEvidence {
  readonly districtKey: string;
  readonly eventKey: string;
  readonly kind: "awardsPostedRaised" | "pointsLowered";
  /** `pointsLowered` only. */
  readonly teamKey?: string;
  /** `pointsLowered` only. */
  readonly category?: (typeof EVIDENCE_POINT_CATEGORIES)[number];
  /** The published value, rendered. */
  readonly published: string;
  /** This run's value, rendered. */
  readonly next: string;
}

type EvidencePointsRow = DistrictArtifact["teams"][number]["eventPoints"][number];

/** What one artifact says about one event, for the evidence rule only. */
interface EvidenceEventFacts {
  /** True when any row of the event carries a state block. */
  stateSeen: boolean;
  /** The fold of `awardsPosted`: true when any row of the event has it true. */
  awardsPosted: boolean;
  /** Each team's first `eventPoints` row at the event. Insertion order is the artifact's team order. */
  readonly rows: Map<string, EvidencePointsRow>;
}

/**
 * The facts of the events handed in, gathered in one walk. THE FOLD IS THE
 * 261009-ul3 MODULE'S OWN RULE, STATED AGAIN: that module's event fold is not
 * exported and that file is not edited by this task. A flag is true for an
 * event when any `eventPoints` or `remainingEvents` row of the event carries a
 * state with it true, and the first `eventPoints` row a team holds at the
 * event is its row. A test pins the two folds against each other.
 */
function evidenceFacts(artifact: DistrictArtifact, eventKeys: ReadonlySet<string>): Map<string, EvidenceEventFacts> {
  const byEvent = new Map<string, EvidenceEventFacts>();
  const factsFor = (eventKey: string): EvidenceEventFacts => {
    let facts = byEvent.get(eventKey);
    if (facts === undefined) {
      facts = { stateSeen: false, awardsPosted: false, rows: new Map() };
      byEvent.set(eventKey, facts);
    }
    return facts;
  };
  const fold = (facts: EvidenceEventFacts, state: EvidencePointsRow["state"]): void => {
    if (state === undefined) return;
    facts.stateSeen = true;
    if (state.awardsPosted) facts.awardsPosted = true;
  };
  for (const team of artifact.teams) {
    for (const row of team.eventPoints) {
      if (!eventKeys.has(row.eventKey)) continue;
      const facts = factsFor(row.eventKey);
      fold(facts, row.state);
      if (!facts.rows.has(team.teamKey)) facts.rows.set(team.teamKey, row);
    }
    for (const row of team.remainingEvents) {
      if (!eventKeys.has(row.eventKey)) continue;
      fold(factsFor(row.eventKey), row.state);
    }
  }
  return byEvent;
}

/**
 * What this run (`next`) would write over the published artifact, for the
 * events handed in only. Pure. Events come in ascending key order. Within an
 * event the flag comes first, then the lowered values in this run's team
 * order and the order of `EVIDENCE_POINT_CATEGORIES`.
 *
 * | kind                 | reported when                                                                                   |
 * |----------------------|-------------------------------------------------------------------------------------------------|
 * | `awardsPostedRaised` | this run's fold of `awardsPosted` for the event is true and the published fold is not true      |
 * | `pointsLowered`      | both artifacts hold an `eventPoints` row for the team at the event and this run's number is lower |
 *
 * NOT TRUE IS THREE CASES, each of them "the Worker has not confirmed it":
 * false, no state on any row of the event (`no state`), and no row for the
 * event at all (`no row`). A higher number, an equal number, a row only this
 * run holds and a row only the published artifact holds are not evidence: the
 * last is already a refusal of the 261009-ul3 guard.
 */
export function compareForLiveEvidence(published: DistrictArtifact, next: DistrictArtifact, eventKeys: ReadonlySet<string>): LiveEvidence[] {
  const publishedFacts = evidenceFacts(published, eventKeys);
  const nextFacts = evidenceFacts(next, eventKeys);
  const districtKey = next.districtKey;
  const evidence: LiveEvidence[] = [];

  for (const eventKey of [...eventKeys].sort(byText)) {
    const now = nextFacts.get(eventKey);
    // This run names no row of the event: it writes nothing there to compare.
    if (now === undefined) continue;
    const was = publishedFacts.get(eventKey);

    // (i) The flag. This run would write it true where the published file
    // does not hold it true.
    if (now.awardsPosted && was?.awardsPosted !== true) {
      evidence.push({ districtKey, eventKey, kind: "awardsPostedRaised", published: was === undefined ? "no row" : was.stateSeen ? "false" : "no state", next: "true" });
    }

    // (ii) The points of a row both files hold, lower in this run.
    if (was === undefined) continue;
    for (const [teamKey, row] of now.rows) {
      const publishedRow = was.rows.get(teamKey);
      if (publishedRow === undefined) continue;
      for (const category of EVIDENCE_POINT_CATEGORIES) {
        if (row[category] < publishedRow[category]) {
          evidence.push({ districtKey, eventKey, kind: "pointsLowered", teamKey, category, published: String(publishedRow[category]), next: String(row[category]) });
        }
      }
    }
  }
  return evidence;
}

export interface LiveEvidenceCheck {
  readonly evidence: readonly LiveEvidence[];
  /** Distinct, sorted. */
  readonly evidenceDistrictKeys: readonly string[];
  /** `true` only in `enforce` mode with `allowLive` and evidence found. */
  readonly overridden: boolean;
}

/**
 * The evidence check: prints what it finds and returns it. It reads nothing
 * and never throws. A district is looked at when it is not in
 * `alreadyListed`, `calendarWatchEventsAt` gives it at least one event, and
 * `publishedBodies` holds a body for its key that parses as a district
 * artifact. A body that is `null` (a first publish), missing from the map (it
 * could not be read), not JSON or not a district artifact (a shape change) is
 * not compared, and nothing is printed for it: the 261009-ul3 pass has
 * already said what it had to say about it.
 *
 * | mode    | allowLive | evidence found                                                  |
 * |---------|-----------|-----------------------------------------------------------------|
 * | enforce | false     | evidence lines, one skip line per district, with its reason     |
 * | enforce | true      | evidence lines, one override line, `overridden: true`           |
 * | notice  | ignored   | evidence lines, one notice line                                 |
 *
 * The evidence of a district is one line for the flag per event and one line
 * for the lowered values per event, holding their count and the first of
 * them. With no evidence nothing is printed in any mode.
 */
export function checkLiveEvidence(args: {
  readonly stage: string;
  readonly districts: readonly RunDistrict[];
  /** The clock reading of the clock pass this check follows. */
  readonly nowMs: number;
  /** Districts the clock rule listed: not looked at. */
  readonly alreadyListed: ReadonlySet<string>;
  /** This run's artifacts, as handed to the 261009-ul3 pass. */
  readonly details: ReadonlyArray<{ readonly key: string; readonly districtKey: string; readonly artifact: DistrictArtifact }>;
  /** What that pass read, by key. */
  readonly publishedBodies: ReadonlyMap<string, string | null>;
  readonly mode: "enforce" | "notice";
  readonly allowLive: boolean;
  readonly log: (line: string) => void;
}): LiveEvidenceCheck {
  const watched = calendarWatchEventsAt({ districts: args.districts, nowMs: args.nowMs, exclude: args.alreadyListed });
  const evidence: LiveEvidence[] = [];
  const lines: string[] = [];

  const details = [...args.details].sort((a, b) => byText(a.districtKey, b.districtKey));
  for (const detail of details) {
    const events = watched.get(detail.districtKey);
    if (events === undefined) continue;
    const body = args.publishedBodies.get(detail.key);
    if (body === undefined || body === null) continue;
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(body);
    } catch {
      continue;
    }
    const parsed = DistrictArtifactSchema.safeParse(parsedJson);
    if (!parsed.success) continue;

    const found = compareForLiveEvidence(parsed.data, detail.artifact, new Set(events.map((event) => event.eventKey)));
    if (found.length === 0) continue;
    evidence.push(...found);
    // `events` is sorted by key, which is the order the evidence came in.
    for (const event of events) {
      const where =
        `publishDistricts: ${LIVE_DISTRICT_MARKER} ${detail.districtKey}: event ${event.eventKey} is outside the window from its match times and the 24 hours after it, and still inside its calendar window plus 24 hours, ` +
        `until ${instant(event.watchedUntilMs)}, so the Worker may still be watching it.`;
      const atEvent = found.filter((entry) => entry.eventKey === event.eventKey);
      if (atEvent.some((entry) => entry.kind === "awardsPostedRaised")) {
        lines.push(`${where} This run would write awards posted true, and the published file does not hold it true.`);
      }
      const lowered = atEvent.filter((entry) => entry.kind === "pointsLowered");
      const first = lowered[0];
      if (first !== undefined) {
        lines.push(
          `${where} This run would write ${lowered.length} point value(s) lower than the published file holds. ` +
            `The first: team ${first.teamKey ?? "unknown"}, ${first.category ?? "unknown"}, published ${first.published}, this run ${first.next}.`
        );
      }
    }
  }

  const evidenceDistrictKeys = [...new Set(evidence.map((entry) => entry.districtKey))].sort(byText);
  if (evidence.length === 0) return { evidence, evidenceDistrictKeys, overridden: false };

  for (const line of lines) args.log(line);
  if (args.mode === "notice") {
    args.log(
      `publishDistricts: --dry-run uploads nothing, so this is a notice. A run that uploads would skip the ${evidenceDistrictKeys.length} ${LIVE_DISTRICT_MARKER}(s) listed above on evidence, unless --allow-live is given.`
    );
    return { evidence, evidenceDistrictKeys, overridden: false };
  }
  if (args.allowLive) {
    args.log(`publishDistricts: --allow-live was given, so this run publishes the ${evidenceDistrictKeys.length} ${LIVE_DISTRICT_MARKER}(s) listed above too.`);
    return { evidence, evidenceDistrictKeys, overridden: true };
  }
  for (const districtKey of evidenceDistrictKeys) {
    args.log(
      `publishDistricts: ${LIVE_DISTRICT_MARKER} ${districtKey} is skipped ${args.stage} on evidence: this run uploads nothing of it, and its published file stays as the Worker has it.`
    );
  }
  return { evidence, evidenceDistrictKeys, overridden: false };
}
