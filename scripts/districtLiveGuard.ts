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
 * This module never reads the wall clock or the environment. The clock, the
 * corpus handle, the reader and the logger are handed in, so every test runs
 * without a network.
 */
import type { Corpus } from "../packages/corpus/db.js";
import { buildLiveWindowsManifest, DISTRICT_AWARDS_WATCH_MS } from "../packages/harness/manifests.js";
import { DistrictsIndexArtifactSchema, type DistrictsIndexArtifact } from "../packages/harness/pageArtifacts.js";
import { DistrictPublishRefusedError, type PublishedReader } from "./districtPublishGuard.js";

/** Every line this module logs, and every message it throws, contains this text. */
export const LIVE_DISTRICT_MARKER = "live district";

/** The `generation` handed to the builder. A label only: the manifest it stamps is read for its windows and thrown away, never published. */
const LIVE_GUARD_GENERATION = "district-live-guard-not-published";

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
  return live.sort((a, b) => byText(a.districtKey, b.districtKey) || byText(a.eventKey, b.eventKey));
}

function instant(ms: number | null): string {
  return ms === null ? "none" : new Date(ms).toISOString();
}

function liveEventLine(event: LiveDistrictEvent): string {
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
 * district is never a reason to throw. It prints one line per live event and
 * then one skip line per district, in sorted order, and nothing at all when
 * nothing is live.
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
  const live = liveDistrictEventsAt(args.db, { districts: args.districts, nowMs: args.nowMs }).filter((event) => !alreadyListed.has(event.districtKey));
  const liveDistrictKeys = [...new Set(live.map((event) => event.districtKey))].sort(byText);
  if (live.length === 0) return { live, liveDistrictKeys, overridden: false, unchecked: false };

  for (const event of live) args.log(liveEventLine(event));
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
