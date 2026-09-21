/**
 * The two offline-published manifests the Worker reads every tick: which
 * events are currently live, and which algorithm versions it is allowed
 * to advance. Both follow `pageArtifacts.ts`'s preamble convention
 * (`schemaVersion`/`generation`/`computedAt`) so a published manifest
 * carries the same "which publish run produced this" stamp every other
 * published object does.
 *
 * The schemas/predicate/constants themselves live in `./manifestSchemas.js`
 * — see that file's header for why: this module imports the corpus types
 * and the offline algorithm modules directly, so it must never be
 * imported by the Worker, but `apps/worker/src/liveWindows.ts` genuinely
 * needs the SAME schemas/`isLiveAt` this file's builders validate against
 * (one definition, shared, never redefined). This file re-exports every
 * symbol `manifestSchemas.ts` defines, unchanged, so every pre-existing
 * call site here and in `manifests.test.ts` keeps working without
 * modification — this file is still where the OFFLINE builders
 * (`buildLiveWindowsManifest`, `buildAlgorithmsManifest`) live; only the
 * pure schema half moved.
 */
import { opr } from "../core/algorithms/opr.js";
import { epa } from "../core/algorithms/epa.js";
import { spr } from "../core/algorithms/spr.js";
import type { AlgorithmModule } from "../core/algorithms/types.js";
import type { Corpus } from "../corpus/db.js";
import {
  AlgorithmManifestEntrySchema,
  AlgorithmsManifestSchema,
  isLiveAt,
  LIVE_WINDOW_PAD_MS,
  LiveWindowEntrySchema,
  LiveWindowsManifestSchema,
  MANIFEST_SCHEMA_VERSION,
  MissingManifestVersionSeparatorError,
  PUBLISHED_ALGORITHM_IDS,
  splitManifestVersion,
  type AlgorithmManifestEntry,
  type AlgorithmsManifest,
  type LiveWindowEntry,
  type LiveWindowsManifest,
} from "./manifestSchemas.js";

export {
  AlgorithmManifestEntrySchema,
  AlgorithmsManifestSchema,
  isLiveAt,
  LIVE_WINDOW_PAD_MS,
  LiveWindowEntrySchema,
  LiveWindowsManifestSchema,
  MANIFEST_SCHEMA_VERSION,
  MissingManifestVersionSeparatorError,
  PUBLISHED_ALGORITHM_IDS,
};
export type { AlgorithmManifestEntry, AlgorithmsManifest, LiveWindowEntry, LiveWindowsManifest };

// ---------------------------------------------------------------------------
// The live-windows manifest (offline builder only — schema above)
// ---------------------------------------------------------------------------

interface EventWindowRow {
  event_key: string;
  year: number;
  start_date: string;
  min_sort_time: number | null;
  max_sort_time: number | null;
  match_count: number;
}

/** Lead before a zero-match event's `start_date` midnight UTC that its probe window opens — covers a local morning start whose UTC date rolls back one day (e.g. UTC+11 at 08:00 local is 21:00Z the day before). */
export const PROBE_WINDOW_LEAD_MS = 12 * 60 * 60 * 1000;

/** Span of a zero-match event's probe window, measured from `start_date` midnight UTC — matches the historical 4-day constant this file used before and covers a multi-day championship. */
export const PROBE_WINDOW_SPAN_MS = 4 * 24 * 60 * 60 * 1000;

/**
 * The probe window a ZERO-MATCH event gets, or `undefined` when it gets none:
 * an unparseable `start_date`, or a window already closed at `nowMs`.
 *
 * ONE FUNCTION, TWO CALLERS, ON PURPOSE (quick task 260921-5qw).
 * `buildLiveWindowsManifest` publishes this window, and `publish.ts` publishes
 * a stub event artifact for exactly the events it returns a window for. The
 * Worker can promote an event to live folding only if it has a window, and a
 * promoted event with no artifact renders with no name and no tier cuts, so
 * the two decisions must never disagree. The caller checks "zero matches".
 */
export function probeWindowFor(startDate: string, nowMs: number): { startMs: number; endMs: number } | undefined {
  const midnightUtcMs = Date.parse(startDate);
  // An unparseable start_date yields no window at all, never a NaN interval.
  if (!Number.isFinite(midnightUtcMs)) return undefined;
  const endMs = midnightUtcMs + PROBE_WINDOW_SPAN_MS;
  // A window already closed when the manifest is built can never be live.
  if (endMs <= nowMs) return undefined;
  return { startMs: midnightUtcMs - PROBE_WINDOW_LEAD_MS, endMs };
}

export interface BuildLiveWindowsManifestOptions {
  /** Seasons whose events should appear in the manifest — e.g. the corpus's covered range, 2022-2026. */
  readonly seasons: readonly number[];
  /** Overrides `LIVE_WINDOW_PAD_MS` for testing/tuning. */
  readonly padMs?: number;
  /** A short opaque string identifying the publish run that produced this manifest. */
  readonly generation: string;
  /** ISO timestamp of when this manifest was computed. */
  readonly computedAt: string;
  /**
   * The retention clock for the "can this window ever be live again?" filter
   * below. Defaults to `Date.parse(computedAt)`, so the manifest is pruned
   * against the instant it was built — deterministic, and derived from a field
   * every caller already supplies rather than a hidden `Date.now()`.
   * Tests whose fixture windows sit at arbitrary epoch offsets pass this
   * explicitly (e.g. `nowMs: 0`) to keep those windows "in the future".
   */
  readonly nowMs?: number;
}

/**
 * Derives every requested season's event windows from the events' OWN match
 * timestamps rather than from a calendar, WITH ONE EXCEPTION: an event with
 * zero matches in the corpus gets a PROBE window instead, derived from
 * `start_date` alone. The corpus's `events` table has a `start_date` but no
 * end date, while `matches.sort_time` already resolves to `actual_time ??
 * predicted_time ?? time ?? fallback` (`packages/ingest/normalize.ts`) — so a
 * live MEASURED event's scheduled matches already carry usable predicted
 * times, and its real window is exactly the span of its own matches, padded
 * by `LIVE_WINDOW_PAD_MS` on each side.
 *
 * RULE 1, CORRECTED (quick task 260920-lny). The rule that used to live here
 * read "TBA publishes match schedules well before an event runs, so a
 * merely-SCHEDULED event already yields a real, measured window" — that
 * premise is FALSE for offseason play. Chezy Champs 2026 (`2026cc`) published
 * 86 real matches whose first `sort_time` landed two minutes AFTER the last
 * manifest publish; the corpus held zero matches for it at build time, so
 * under the old rule it got no window at all and was never picked up live.
 * Forty more 2026 offseason events were queued to fail the identical way.
 *
 * A zero-match event now gets a calendar window instead of none,
 * `[start_date 00:00 UTC - PROBE_WINDOW_LEAD_MS, + PROBE_WINDOW_SPAN_MS)`,
 * marked `inferred: true`. This is the same field, and the same VALUE, that
 * caused the 2026-08-29 outage's cause B
 * (`.planning/debug/resolved/worker-tick-exceeds-cpu-budget.md`) — what makes
 * reintroducing it safe is that `inferred: true` is now a CONTRACT both sides
 * read (see `manifestSchemas.ts`'s doc comment on the field): the Worker
 * never treats a probe entry as foldable on the window alone. It answers
 * liveness for it with exactly ONE cheap conditional TBA request and does
 * nothing else — no algorithms-manifest read, no `buildAlgorithmModules`, no
 * D1 batch, no artifact write — unless that poll actually returns matches
 * (`apps/worker/src/scheduled.ts`'s `runProbes`). The condition that killed
 * the isolate in August 2026 was a blind window treated as fully live; no
 * `inferred: true` window is ever fed into that path any more, in a manifest
 * this builder produces or in one already in the wild (an outage-era
 * manifest's 200 stale `inferred: true` entries now land on the cheap probe
 * path too, which is strictly safer than what they did at the time). An
 * event whose `start_date` does not parse gets no entry at all, never a NaN
 * interval — `loadLiveEventsAt` refuses the WHOLE manifest on a non-finite
 * `startMs`/`endMs` (`LiveWindowShapeError`), so one bad row must not be
 * allowed to take every other window down with it.
 *
 * RULE 2 (unchanged): NO WINDOW THAT CAN NEVER BE LIVE AGAIN, measured or
 * probe. A window is dropped when `endMs <= nowMs` — already closed when the
 * manifest was built, so it cannot be live at any instant at which this
 * manifest could be read. The Worker reads this object on EVERY cron tick
 * inside a 10ms CPU budget; shipping years of dead seasons made the
 * do-nothing tick cost several ms before it did anything at all.
 * `liveWindows.ts` ALSO defends itself at read time — keep both: this one
 * shrinks the artifact, that one bounds the cost of whatever it contains.
 */
export function buildLiveWindowsManifest(db: Corpus, options: BuildLiveWindowsManifestOptions): LiveWindowsManifest {
  const { seasons, generation, computedAt } = options;
  const padMs = options.padMs ?? LIVE_WINDOW_PAD_MS;
  const nowMs = options.nowMs ?? Date.parse(computedAt);
  if (!Number.isFinite(nowMs)) {
    throw new Error(`buildLiveWindowsManifest: computedAt "${computedAt}" is not a parseable timestamp and no explicit nowMs was supplied — the retention filter has no clock to prune against`);
  }

  const windows: LiveWindowEntry[] = [];

  if (seasons.length > 0) {
    const placeholders = seasons.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT e.event_key AS event_key, e.year AS year, e.start_date AS start_date,
                MIN(m.sort_time) AS min_sort_time, MAX(m.sort_time) AS max_sort_time,
                COUNT(m.match_key) AS match_count
         FROM events e
         LEFT JOIN matches m ON m.event_key = e.event_key
         WHERE e.year IN (${placeholders})
         GROUP BY e.event_key
         ORDER BY e.event_key ASC`
      )
      .all(...seasons) as EventWindowRow[];

    for (const row of rows) {
      // (1) An event with no matches in the corpus gets a PROBE window, not
      // no window — see this function's header (RULE 1, CORRECTED) for why a
      // blind guess is safe now when it was not before.
      if (row.match_count === 0 || row.min_sort_time === null || row.max_sort_time === null) {
        // `probeWindowFor` drops an unparseable start_date (never a NaN
        // interval — see the header for why that would be worse than a
        // missing window) and applies (2) to a probe entry exactly as to a
        // measured one. `publish.ts` asks it the same question.
        const probe = probeWindowFor(row.start_date, nowMs);
        if (probe === undefined) continue;

        windows.push({
          eventKey: row.event_key,
          season: row.year,
          startMs: probe.startMs,
          endMs: probe.endMs,
          inferred: true,
        });
        continue;
      }

      const endMs = row.max_sort_time + padMs;
      // (2) A window that had already closed when this manifest was built can
      // never be live for any reader of this manifest. Don't ship it.
      if (endMs <= nowMs) continue;

      windows.push({
        eventKey: row.event_key,
        season: row.year,
        startMs: row.min_sort_time - padMs,
        endMs,
        inferred: false,
      });
    }
  }

  return LiveWindowsManifestSchema.parse({
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generation,
    computedAt,
    windows,
  });
}

// ---------------------------------------------------------------------------
// The algorithms manifest (offline builder only — schema in manifestSchemas.ts)
// ---------------------------------------------------------------------------

/**
 * The one opr/epa/spr registry, keyed by wire id. `publish.ts` re-exports
 * it as `BASE_PUBLISH_ALGORITHMS`; each key must equal its module's `id`.
 */
export const PUBLISHED_ALGORITHM_MODULES: Record<string, AlgorithmModule<any>> = { opr, epa, spr };

export interface BuildAlgorithmsManifestOptions {
  /** A short opaque string identifying the publish run that produced this manifest. */
  readonly generation: string;
  /** ISO timestamp of when this manifest was computed. */
  readonly computedAt: string;
}

/**
 * The three published entries, each reading its `id` and `version`
 * straight from its own module (never a guessed/hardcoded string), so the
 * manifest id and the artifact-key id segment cannot disagree.
 */
export function buildAlgorithmsManifest(options: BuildAlgorithmsManifestOptions): AlgorithmsManifest {
  const { generation, computedAt } = options;

  // Every published algorithm carries its version on its own module.
  // Derived from PUBLISHED_ALGORITHM_IDS rather than written out, so adding an
  // algorithm is a registry edit rather than an edit here that someone has to
  // remember. The lookup throws on an unregistered id instead of silently
  // emitting a short manifest -- a missing entry would make the algorithm
  // invisible to the browser while every test still passed.
  const modules = PUBLISHED_ALGORITHM_MODULES;

  const algorithms: AlgorithmManifestEntry[] = PUBLISHED_ALGORITHM_IDS.map((id) => {
    const mod = modules[id];
    if (!mod) {
      throw new Error(
        `buildAlgorithmsManifest: no module registered for published id "${id}" (known: ${Object.keys(modules).join(", ")})`,
      );
    }
    const split = splitManifestVersion(mod.id, mod.version);
    return { id: mod.id, version: mod.version, codeVersion: split.codeVersion, paramSetName: split.paramSetName };
  });

  return AlgorithmsManifestSchema.parse({
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generation,
    computedAt,
    algorithms,
  });
}
