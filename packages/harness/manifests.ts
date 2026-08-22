/**
 * The two offline-published manifests the Worker reads every tick (D-18/D-03,
 * plan 04-03 Task 1): which events are currently live, and which algorithm
 * versions it is allowed to advance. Both follow `pageArtifacts.ts`'s
 * preamble convention (`schemaVersion`/`generation`/`computedAt`, D-04) so a
 * published manifest carries the same "which publish run produced this"
 * stamp every other published object does.
 *
 * Neither manifest builder needs to be Worker-importable — they run offline,
 * in the publish pipeline, reading the local corpus and the committed
 * promoted-version file. The Worker only ever reads the JSON these functions
 * produce, never imports this module.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { opr } from "../core/algorithms/opr.js";
import { epa } from "../core/algorithms/epa.js";
import { Sigma1ParamsSchema } from "../core/algorithms/sigma1/index.js";
import { warnIfNewerPromotedSigma1 } from "./cli.js";
import { PromotedVersionSchema } from "./promote.js";
import type { Corpus } from "../corpus/db.js";

/** Shared literal for both manifests below — bumped whenever either shape changes in a way the Worker must know about. Independent of `pageArtifacts.ts`'s `PAGE_ARTIFACT_SCHEMA_VERSION` and `artifact.ts`'s `ARTIFACT_SCHEMA_VERSION` (different consumer, different evolution schedule — same reasoning `pageArtifacts.ts`'s file header already states). */
const MANIFEST_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// D-18: the live-windows manifest
// ---------------------------------------------------------------------------

/**
 * D-18/D-15: one hour of pad on each side of an event's own observed match
 * timestamps, so a tick still catches an event whose first match runs early
 * or whose last match runs late. Exported so a caller can override it
 * explicitly (`buildLiveWindowsManifest`'s `padMs` option) without
 * hardcoding a second copy of this constant.
 */
export const LIVE_WINDOW_PAD_MS = 60 * 60 * 1000;

/** D-18: an event never observed to have any matches at all falls back to a fixed 4-day window starting at its `start_date` (00:00 UTC) — flagged `inferred: true` so a reader can see the window was guessed, not measured. */
const INFERRED_WINDOW_DURATION_MS = 4 * 24 * 60 * 60 * 1000;

const LiveWindowEntrySchema = z.object({
  eventKey: z.string().min(1),
  season: z.number().int(),
  /** Integer epoch milliseconds — a numeric half-open interval, not a date string, so `isLiveAt` is an integer comparison, never a parse. */
  startMs: z.number().int(),
  endMs: z.number().int(),
  /** D-18: true when this window was derived from `start_date` alone (the event has no matches in the corpus yet) rather than from real observed match timestamps. */
  inferred: z.boolean(),
});

export type LiveWindowEntry = z.infer<typeof LiveWindowEntrySchema>;

export const LiveWindowsManifestSchema = z.object({
  schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
  /** D-04: a short opaque string identifying the publish run that produced this manifest. */
  generation: z.string().min(1),
  /** D-04: ISO timestamp of when this manifest was computed. */
  computedAt: z.string().min(1),
  windows: z.array(LiveWindowEntrySchema),
});

export type LiveWindowsManifest = z.infer<typeof LiveWindowsManifestSchema>;

/**
 * D-18's single liveness predicate — the offline builder and the Worker
 * share this one definition of "live" rather than each writing their own
 * inequality. Half-open: `[startMs, endMs)`. An event does NOT remain live
 * for one extra instant at `endMs` — an inclusive upper bound would leave an
 * event live for one tick past its last match, and two back-to-back events
 * at the same venue would both read as live at the instant one ends.
 */
export function isLiveAt(window: Pick<LiveWindowEntry, "startMs" | "endMs">, epochMs: number): boolean {
  return window.startMs <= epochMs && epochMs < window.endMs;
}

interface EventWindowRow {
  event_key: string;
  year: number;
  start_date: string;
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
}

/**
 * Derives every requested season's event windows from the events' OWN match
 * timestamps rather than from a calendar (D-18). The corpus's `events` table
 * has a `start_date` but no end date, while `matches.sort_time` already
 * resolves to `actual_time ?? predicted_time ?? time ?? fallback`
 * (`packages/ingest/normalize.ts`) — so a live event's scheduled matches
 * already carry usable predicted times, and the real window is exactly the
 * span of the event's own matches, padded by `LIVE_WINDOW_PAD_MS` on each
 * side. An event with zero matches in the corpus falls back to
 * `[start_date 00:00 UTC, +4 days)`, flagged `inferred: true` — D-18 already
 * accepts this staleness class: the manifest is only as fresh as the last
 * offline publish, and republishing is what fixes it.
 */
export function buildLiveWindowsManifest(db: Corpus, options: BuildLiveWindowsManifestOptions): LiveWindowsManifest {
  const { seasons, generation, computedAt } = options;
  const padMs = options.padMs ?? LIVE_WINDOW_PAD_MS;

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
      if (row.match_count > 0 && row.min_sort_time !== null && row.max_sort_time !== null) {
        windows.push({
          eventKey: row.event_key,
          season: row.year,
          startMs: row.min_sort_time - padMs,
          endMs: row.max_sort_time + padMs,
          inferred: false,
        });
      } else {
        const startMs = Date.parse(`${row.start_date}T00:00:00.000Z`);
        windows.push({
          eventKey: row.event_key,
          season: row.year,
          startMs,
          endMs: startMs + INFERRED_WINDOW_DURATION_MS,
          inferred: true,
        });
      }
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
// D-03: the algorithms manifest
// ---------------------------------------------------------------------------

/** D-03: the four Phase-2/Phase-3 experiment ids that exist to answer harness questions and must never appear in a user-facing manifest — see `AlgorithmsManifestSchema`'s refinement below. */
const HARNESS_ONLY_ALGORITHM_IDS = new Set(["sigma1-defaults", "sigma1-seasonsd", "sigma1-normalcdf", "sigma1-adapt"]);

/** D-03: the published set is exactly these three ids, in this order. */
export const PUBLISHED_ALGORITHM_IDS = ["opr", "epa", "sigma1"] as const;

const AlgorithmManifestEntrySchema = z.object({
  id: z.string().min(1),
  /** `{codeVersion}+{paramSetName}` — D-13's version identity. */
  version: z.string().min(1),
  codeVersion: z.string().min(1),
  paramSetName: z.string().min(1),
  /** Present only for the Sigma1 entry — a Worker rebuilds the module with `makeSigma1({ params, ... })`; OPR/EPA carry no tunable parameter set. */
  params: Sigma1ParamsSchema.optional(),
});

export type AlgorithmManifestEntry = z.infer<typeof AlgorithmManifestEntrySchema>;

export const AlgorithmsManifestSchema = z
  .object({
    schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
    /** D-04: a short opaque string identifying the publish run that produced this manifest. */
    generation: z.string().min(1),
    /** D-04: ISO timestamp of when this manifest was computed. */
    computedAt: z.string().min(1),
    algorithms: z.array(AlgorithmManifestEntrySchema),
  })
  .check((ctx) => {
    for (const entry of ctx.value.algorithms) {
      if (HARNESS_ONLY_ALGORITHM_IDS.has(entry.id)) {
        ctx.issues.push({
          code: "custom",
          message:
            `D-03: algorithm id "${entry.id}" is harness-only (one of sigma1-defaults/sigma1-seasonsd/` +
            `sigma1-normalcdf/sigma1-adapt) and must never appear in the published algorithms manifest — ` +
            `it exists to answer a Phase 2/3 harness question, not a Phase 5 dropdown choice`,
          path: ["algorithms"],
          input: ctx.value,
        });
      }
    }
  });

export type AlgorithmsManifest = z.infer<typeof AlgorithmsManifestSchema>;

/**
 * `packages/harness/cli.ts`'s `PROMOTED_SIGMA1_VERSION_PATH`/
 * `ALGORITHM_VERSIONS_DIR` are module-private (not exported) — reimplemented
 * here rather than imported, the same small, deliberate duplication
 * `cli.ts`'s own `ALGORITHM_VERSIONS_DIR` comment already documents for
 * mirroring `promote.ts`'s private `ALGORITHM_VERSIONS_DIR`. Keeping the
 * literal path identical to `cli.ts`'s is what keeps this manifest and
 * `applyPromotedOverrides` naming the SAME promoted version (T-04-16) —
 * `warnIfNewerPromotedSigma1`, imported from `cli.ts` unchanged, is called
 * before reading it, exactly as `applyPromotedOverrides` does, so a newer
 * committed version file is exactly as loud here as it is in a harness run.
 */
const PROMOTED_SIGMA1_VERSION_PATH = join("data", "algorithm-versions", "sigma1@2.0.0+tuned-2026-08.json");
const ALGORITHM_VERSIONS_DIR = join("data", "algorithm-versions");

/** Thrown when an algorithm's `version` string does not carry D-13's `{codeVersion}+{paramSetName}` shape — fails at manifest-build time rather than publishing a path nothing can ever fetch, mirroring `pageArtifacts.ts`'s `MissingVersionSeparatorError` discipline. */
export class MissingManifestVersionSeparatorError extends Error {
  constructor(algorithmId: string, version: string) {
    super(
      `buildAlgorithmsManifest: algorithm "${algorithmId}"'s version "${version}" does not carry D-13's ` +
        `"{codeVersion}+{paramSetName}" shape (no "+" found)`
    );
    this.name = "MissingManifestVersionSeparatorError";
  }
}

function splitVersion(algorithmId: string, version: string): { codeVersion: string; paramSetName: string } {
  const separatorIndex = version.indexOf("+");
  if (separatorIndex === -1) {
    throw new MissingManifestVersionSeparatorError(algorithmId, version);
  }
  return {
    codeVersion: version.slice(0, separatorIndex),
    paramSetName: version.slice(separatorIndex + 1),
  };
}

export interface BuildAlgorithmsManifestOptions {
  /** D-04: a short opaque string identifying the publish run that produced this manifest. */
  readonly generation: string;
  /** D-04: ISO timestamp of when this manifest was computed. */
  readonly computedAt: string;
}

/**
 * D-03: the three published entries — `opr` and `epa` read their `id` and
 * `version` straight from the modules themselves (never a guessed/hardcoded
 * string), and the Sigma1 entry is read from the committed promoted version
 * file `applyPromotedOverrides` (`cli.ts`) pins, so this manifest and the
 * harness's own promoted-version resolution can never name two different
 * versions (T-04-16).
 */
export function buildAlgorithmsManifest(options: BuildAlgorithmsManifestOptions): AlgorithmsManifest {
  const { generation, computedAt } = options;

  const oprSplit = splitVersion(opr.id, opr.version);
  const epaSplit = splitVersion(epa.id, epa.version);

  // D-12 / 03-REVIEW WR-03: the same staleness check `applyPromotedOverrides`
  // runs before reading the pinned file — a newer committed version must be
  // exactly as loud here as it is in a harness run.
  warnIfNewerPromotedSigma1(ALGORITHM_VERSIONS_DIR, PROMOTED_SIGMA1_VERSION_PATH);
  const promotedRaw: unknown = JSON.parse(readFileSync(PROMOTED_SIGMA1_VERSION_PATH, "utf8"));
  const promoted = PromotedVersionSchema.parse(promotedRaw);
  const sigma1Split = splitVersion(promoted.id, promoted.version);

  const algorithms: AlgorithmManifestEntry[] = [
    { id: opr.id, version: opr.version, codeVersion: oprSplit.codeVersion, paramSetName: oprSplit.paramSetName },
    { id: epa.id, version: epa.version, codeVersion: epaSplit.codeVersion, paramSetName: epaSplit.paramSetName },
    {
      id: promoted.id,
      version: promoted.version,
      codeVersion: sigma1Split.codeVersion,
      paramSetName: sigma1Split.paramSetName,
      params: promoted.params,
    },
  ];

  return AlgorithmsManifestSchema.parse({
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generation,
    computedAt,
    algorithms,
  });
}
