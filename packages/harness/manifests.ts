/**
 * The two offline-published manifests the Worker reads every tick (D-18/D-03,
 * plan 04-03 Task 1): which events are currently live, and which algorithm
 * versions it is allowed to advance. Both follow `pageArtifacts.ts`'s
 * preamble convention (`schemaVersion`/`generation`/`computedAt`, D-04) so a
 * published manifest carries the same "which publish run produced this"
 * stamp every other published object does.
 *
 * The schemas/predicate/constants themselves live in `./manifestSchemas.js`
 * (plan 04-06 Task 1, Rule 3 blocking fix) — see that file's header for why:
 * this module imports `node:fs`/`node:path` and `./cli.js` (which pulls in
 * the corpus/`better-sqlite3`) directly, so it must never be imported by the
 * Worker, but `apps/worker/src/liveWindows.ts` genuinely needs the SAME
 * schemas/`isLiveAt` this file's builders validate against (one definition,
 * shared, never redefined). This file re-exports every symbol
 * `manifestSchemas.ts` defines, unchanged, so every pre-existing call site
 * here and in `manifests.test.ts` keeps working without modification — this
 * file is still where the OFFLINE builders (`buildLiveWindowsManifest`,
 * `buildAlgorithmsManifest`) live; only the pure schema half moved.
 */
import { readFileSync } from "node:fs";
import { opr } from "../core/algorithms/opr.js";
import { epa } from "../core/algorithms/epa.js";
import { bpr } from "../core/algorithms/bpr.js";
import { warnIfNewerPromotedVpr } from "./cli.js";
import { PromotedVersionSchema } from "./promote.js";
import { ALGORITHM_VERSIONS_DIR, PROMOTED_VPR_VERSION_PATH } from "./promotedVersionPath.js";
import { resolveParamSets } from "./seasonParamSets.js";
import type { Corpus } from "../corpus/db.js";
import {
  AlgorithmManifestEntrySchema,
  AlgorithmsManifestSchema,
  HARNESS_ONLY_ALGORITHM_IDS,
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
  HARNESS_ONLY_ALGORITHM_IDS,
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
// D-18: the live-windows manifest (offline builder only — schema above)
// ---------------------------------------------------------------------------

interface EventWindowRow {
  event_key: string;
  year: number;
  min_sort_time: number | null;
  max_sort_time: number | null;
  match_count: number;
}

export interface BuildLiveWindowsManifestOptions {
  /** Seasons whose events should appear in the manifest — e.g. the corpus's covered range, 2022-2026. */
  readonly seasons: readonly number[];
  /** Overrides `LIVE_WINDOW_PAD_MS` for testing/tuning. */
  readonly padMs?: number;
  /** D-04: a short opaque string identifying the publish run that produced this manifest. */
  readonly generation: string;
  /** D-04: ISO timestamp of when this manifest was computed. */
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
 * timestamps rather than from a calendar (D-18). The corpus's `events` table
 * has a `start_date` but no end date, while `matches.sort_time` already
 * resolves to `actual_time ?? predicted_time ?? time ?? fallback`
 * (`packages/ingest/normalize.ts`) — so a live event's scheduled matches
 * already carry usable predicted times, and the real window is exactly the
 * span of the event's own matches, padded by `LIVE_WINDOW_PAD_MS` on each side.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT EMIT (both added 2026-08-29)
 * -----------------------------------------------------------------
 * Both come out of the outage post-mortem in
 * `.planning/debug/resolved/worker-tick-exceeds-cpu-budget.md`.
 *
 * 1. NO BLIND WINDOW FOR A ZERO-MATCH EVENT (the outage's trigger).
 *    This used to fall back to `[start_date 00:00 UTC, +4 days)` flagged
 *    `inferred: true`, so that a brand-new event could still be "discovered"
 *    before its schedule reached the corpus. That guess has no observational
 *    basis at all, and 200 of the corpus's events had zero matches — every one
 *    of them silently armed a four-day window in which the deployed Worker
 *    believed an event was live. On 2026-08-28 two such windows opened for
 *    offseason events that were not running (`2026azscor`, `2026scsc`), the
 *    tick stopped taking its `liveEvents.length === 0` early exit, and the full
 *    live path measured 38 ms CPU against a 10 ms budget — 100% of cron ticks
 *    killed with `outcome:"exceededCpu"`, for days, self-healing only when the
 *    guessed windows happened to expire.
 *
 *    D-18's discovery intent is therefore NARROWED, not preserved-in-part:
 *    the `else` branch that produced these was EXACTLY the zero-match case
 *    (`matches.sort_time` is `NOT NULL` in `packages/corpus/schema.sql`, so
 *    `match_count > 0` always implies non-null `MIN`/`MAX`), leaving no
 *    legitimate residue to keep. Discovery is now served by the ingest →
 *    republish cycle instead of a guess: TBA publishes match schedules well
 *    before an event runs, and `sort_time`'s `predicted_time ?? time` fallback
 *    means a merely-SCHEDULED event already yields a real, measured window.
 *    The operational contract this creates is explicit — an event must be
 *    ingested before it can be folded live. That is the same cadence
 *    `docs/worker-operations.md` already documents for a stale manifest.
 *
 *    NOTE the `inferred` FIELD remains in the schema and the Worker still reads
 *    it. Manifests published before this change carry 200 `inferred: true`
 *    entries; removing the field would be a breaking schema change for no gain.
 *    This builder simply never sets it to `true` any more.
 *
 * 2. NO WINDOW THAT CAN NEVER BE LIVE AGAIN (the outage's structural cause).
 *    A window is dropped when `endMs <= nowMs`, i.e. it had already closed when
 *    the manifest was built, so it cannot be live at any instant at which this
 *    manifest could be read. 1,542 of 1,581 windows were in that state. The
 *    Worker reads this object on EVERY cron tick and must decide liveness from
 *    it inside a 10 ms CPU budget; shipping years of dead seasons made the
 *    do-nothing tick cost 5-9 ms before it did anything at all. Pruning here is
 *    the version of that fix with no validation trade-off — it just costs a
 *    republish to take effect, which is why `liveWindows.ts` ALSO defends
 *    itself at read time. Keep both: this one shrinks the artifact, that one
 *    bounds the cost of whatever the artifact happens to contain.
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
        `SELECT e.event_key AS event_key, e.year AS year,
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
      // (1) An event with no matches in the corpus gets NO window. Its window
      // would have to be guessed from `start_date`, and a guessed window is a
      // window in which the Worker burns its whole CPU budget on an event that
      // may not be running at all. See this function's header.
      if (row.match_count === 0 || row.min_sort_time === null || row.max_sort_time === null) continue;

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
// D-03: the algorithms manifest (offline builder only — schema in manifestSchemas.ts)
// ---------------------------------------------------------------------------

// Quick task 260904-2i9: `PROMOTED_VPR_VERSION_PATH`/`ALGORITHM_VERSIONS_DIR`
// now IMPORTED from `./promotedVersionPath.js` rather than reimplemented.
// The old comment here justified duplication on the grounds that `cli.ts`'s
// copies were module-private (not exported) — that premise no longer holds:
// both constants now live in a shared leaf module neither `cli.ts` nor this
// file owns. Keeping this import identical to every other call site's is
// what keeps this manifest and `applyPromotedOverrides` naming the SAME
// promoted version (T-04-16) — `warnIfNewerPromotedVpr`, imported from
// `cli.ts` unchanged, is called before reading it, exactly as
// `applyPromotedOverrides` does, so a newer committed version file is
// exactly as loud here as it is in a harness run.

export interface BuildAlgorithmsManifestOptions {
  /** D-04: a short opaque string identifying the publish run that produced this manifest. */
  readonly generation: string;
  /** D-04: ISO timestamp of when this manifest was computed. */
  readonly computedAt: string;
  /**
   * D-2 (quick task 260904-100): REQUIRED, no default — a default is how the
   * wrong season's parameter set gets published silently. The Worker only
   * ever runs the LIVE season, so the manifest names exactly one season's
   * set (never the full `paramSetsBySeason` map); this is that season.
   */
  readonly paramsSeason: number;
}

/**
 * D-03 (rename D-04/D-05, plan 07-16): the three published entries — `opr`
 * and `epa` read their `id` and `version` straight from the modules
 * themselves (never a guessed/hardcoded string), and the third (published)
 * entry's `id` is read from the committed promoted version file
 * `applyPromotedOverrides` (`cli.ts`) pins — currently `vpr` — so this
 * manifest and the harness's own promoted-version resolution can never name
 * two different versions (T-04-16, and, since the rename, T-07-16-01: the
 * manifest id and the artifact-key id segment cannot disagree without the
 * version file disagreeing with itself).
 */
export function buildAlgorithmsManifest(options: BuildAlgorithmsManifestOptions): AlgorithmsManifest {
  const { generation, computedAt, paramsSeason } = options;

  // VPR's retirement (2026-09-09) removed the ONE promoted-version entry this
  // builder had. Every published algorithm now carries its version on its own
  // module, so the whole pinned-file path — `warnIfNewerPromotedVpr`, the
  // `PROMOTED_VPR_VERSION_PATH` read, `PromotedVersionSchema.parse` and the
  // per-season `resolveParamSets` resolution — is gone from here rather than
  // left reading a retired algorithm's file on every publish. It was not
  // merely dead: a `readFileSync` on a file nothing else needs any more would
  // have taken manifest building down the day that file was tidied away.
  //
  // `applyPromotedOverrides` in `cli.ts` still owns that machinery for the
  // harness's own tuning runs, which are a different consumer with a different
  // lifetime; this function no longer shares it.
  //
  // Derived from PUBLISHED_ALGORITHM_IDS rather than written out, so adding an
  // algorithm is a registry edit rather than an edit here that someone has to
  // remember. The lookup throws on an unregistered id instead of silently
  // emitting a short manifest -- a missing entry would make the algorithm
  // invisible to the browser while every test still passed.
  const modules: Record<string, { id: string; version: string }> = { opr, epa, bpr };

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
