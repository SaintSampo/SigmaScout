/**
 * The LIVE METRIC SIDECAR — the per-event, per-algorithm ephemeral object the
 * live Worker writes INSTEAD of rewriting every touched team's whole season
 * artifact each tick (quick task 260917-jr4, D-01).
 *
 * WHAT IT IS FOR. A live tick used to read and rewrite one `v1/team/...`
 * artifact per touched team per algorithm — twelve whole season artifacts on
 * an ordinary tick, 7.6 ms of a 17.5 ms Phase B. Everything in those rewrites
 * except ONE thing is derivable in the browser from files the robot page
 * already fetches (the event artifact's own played rows). The exception is
 * each newly-folded match's PER-TEAM POST-MATCH METRICS, which exist only
 * inside the tick's own algorithm state. This object carries exactly that and
 * nothing else.
 *
 * IT IS NEVER PUBLISHED DATA. Three structural guarantees, not conventions:
 *
 *   1. Its key lives under a NEW top-level `v1/live/` prefix, a sibling of
 *      `v1/event/` and `v1/presim/`, so a list-driven sweep can delete the
 *      whole prefix and nothing can mistake it for a page.
 *   2. It is deliberately NOT declared in `pageArtifacts.ts`, so it can never
 *      join `PageKind` or `apps/worker/src/artifactWriter.ts`'s
 *      `SCHEMA_BY_PAGE` map — the same choice `preScheduleKey` made, and for
 *      the same reason. A writer keyed on `PageKind` structurally cannot
 *      address it.
 *   3. `ephemeral` is a required literal `true`. A reader that does not
 *      understand this key fails the parse rather than merging a foreign
 *      object into a robot page.
 *
 * NODE-FREE, ZOD-ONLY, for the same reason `metricHistorySchema.ts` is split
 * out: this module sits on the BROWSER's import graph (the team page and the
 * match page both read a sidecar during a live event) and on the read-only
 * state probe's, neither of which may pull in a Node-only or write-capable
 * module.
 *
 * WHAT TRAVELS AND WHAT DELIBERATELY DOES NOT.
 *
 * - `spread` is NOT carried. SPR emits it, `MetricValue` refuses to render
 *   it, and `metricHistorySeries.ts` reads its band from the `sigma` entry
 *   precisely so it cannot regress onto `spread`. Carrying a field nothing
 *   may display would be bytes spent on a hazard.
 * - `percentile` is NOT carried. The live tick computes none today either —
 *   see `touchedEventTeamMetrics`' own "known limitation" doc comment in
 *   `apps/worker/src/artifactMerge.ts`. A sidecar row therefore matches a
 *   published metric-history row minus `percentile`, which is exactly what
 *   the live path already did.
 * - `matchIndex` is NOT carried. The consumer assigns each derived row its
 *   ARRAY POSITION in the extended history, which is the only thing
 *   `buildMetricSeries` (`x: index + 1`), `preMatchMetrics`,
 *   `endOfEventMetrics` and `officialSnapshotRow` actually use. The live tick
 *   has in fact always written an EVENT-LOCAL index into a field documented
 *   as season-wide (`scheduled.ts` builds `matchIndexByKey` from one event's
 *   own ordered match keys), and nothing in production web reads it.
 * - `SIGMA_METRIC_KEY` is an ORDINARY member of `metricKeys` for a Sigma
 *   algorithm. There is no special case for Sigma anywhere in this encoding.
 *
 * ONE PRESERVED FLAW, NAMED RATHER THAN INTRODUCED. A tick that folds TWO
 * matches at once writes two rows carrying the SAME end-of-tick metrics
 * record, because the tick reads `touchedMetrics` once. That is exactly what
 * `mergeTeamSeasonArtifact` does today (its `matches.map` reuses one
 * `metrics` record for every row it appends). This module carries the flaw
 * forward unchanged and does not fix it: fixing it would change published
 * numbers and therefore needs its own algorithm version bump.
 *
 * LIFECYCLE. Created lazily by the first tick that folds a match at the event
 * (a 404 read bootstraps an empty sidecar), read-modify-appended on every
 * tick that folds, written with `complete: true` on the tick where the last
 * match folds, and NEVER deleted by the Worker. It becomes inert on its own
 * the moment the event is republished, because every row it carries is then a
 * duplicate the browser drops by match key.
 *
 * STALENESS, without a generation check. The tick's own `stamp.generation` is
 * `tick-{nowMs}`, invented per tick and never the publisher's, so comparing
 * generations against a published artifact is structurally impossible. Two
 * exact guards replace it: the VERSION SEGMENT OF THE KEY (a model change
 * ships under a new algorithm version, so a superseded model's sidecar is a
 * 404, not a bad merge) and MATCH-KEY DEDUP in the consumer (a row for a match
 * the published history already covers is redundant by construction and is
 * dropped whether the sidecar is stale or fresh).
 */
import { z } from "zod";
import { roundMetric } from "./rounding.js";

/** The one spelling of the sidecar's schema version. A reader that sees anything else fails the parse. */
export const LIVE_METRIC_SIDECAR_VERSION = 1;

/**
 * A warn-only byte ceiling on the serialized sidecar.
 *
 * SIZED FROM THE REAL SHAPE: roughly 330 bytes per match (one match key, six
 * team keys, six five-number arrays), so a 147-match 2026 event ends near
 * 48 KB and a 241-match 2016-shaped event near 80 KB. 256 KB is therefore
 * about 3x the largest realistic event — a ceiling that only a genuine defect
 * reaches.
 *
 * THE WRITER MUST NOT THROW ON IT AND MUST NOT TRUNCATE. A throw loses that
 * tick's rows permanently (the event cursor has already advanced, so those
 * matches are never folded again), and truncation would silently punch a hole
 * in the metric-history chart. Crossing the ceiling is a loud log line and
 * nothing else.
 */
export const LIVE_METRIC_SIDECAR_BYTE_CEILING = 256_000;

/**
 * One match's per-team post-match metrics, in the compact positional
 * encoding: `t` names the teams once, and `v[i]` is `t[i]`'s values INDEX-
 * ALIGNED to the sidecar's own `metricKeys` header, with `null` for a key
 * that team has no value for. The header is stated ONCE for the whole
 * sidecar rather than per row, which is most of the size saving.
 */
export const LiveMetricSidecarRowSchema = z.object({
  /** The match key these metrics are the state AFTER. */
  m: z.string().min(1),
  /** Team keys, in the order `v` uses. */
  t: z.array(z.string().min(1)),
  /** Per-team value arrays, index-aligned to `metricKeys`; `null` is "no value for this key". */
  v: z.array(z.array(z.number().nullable())),
});

export type LiveMetricSidecarRow = z.infer<typeof LiveMetricSidecarRowSchema>;

export const LiveMetricSidecarSchema = z.object({
  sidecarVersion: z.literal(LIVE_METRIC_SIDECAR_VERSION),
  /** Required literal. A published-artifact reader that wandered in here fails the parse instead of merging this into a page. */
  ephemeral: z.literal(true),
  eventKey: z.string().min(1),
  season: z.number().int(),
  algorithmId: z.string().min(1),
  algorithmVersion: z.string().min(1),
  /** The WRITING TICK's ISO instant — never a publish generation; the tick has none. */
  computedAt: z.string().min(1),
  /** Set `true` on the tick where the event's last match folds. */
  complete: z.boolean(),
  /** The metric-key header, stated once, in the order every row's value arrays use. */
  metricKeys: z.array(z.string().min(1)),
  /** Append-only, in fold order, one row per match. */
  rows: z.array(LiveMetricSidecarRowSchema),
});

export type LiveMetricSidecar = z.infer<typeof LiveMetricSidecarSchema>;

/** Thrown by `liveMetricSidecarKey` for a version string with no `+` separator — mirrors `pageArtifacts.ts`'s own `assertVersionShape` guard, so a sidecar key can never be written under a half-formed version. */
export class LiveMetricSidecarVersionError extends Error {
  constructor(algorithmId: string, version: string) {
    super(`liveMetricSidecarKey: "${algorithmId}" version "${version}" has no "+" separator — a sidecar key must carry {codeVersion}+{paramSet}`);
    this.name = "LiveMetricSidecarVersionError";
  }
}

/**
 * THE ONE SPELLING of the sidecar's R2 key, imported by BOTH the Worker
 * (`apps/worker/src/artifactWriter.ts`) and the browser
 * (`apps/web/src/lib/api/liveSidecar.ts`) — exactly the rule `preScheduleKey`
 * established, and for exactly its reason: two spellings of this key would be
 * a silent, permanent 404 that no test on either side would catch alone.
 *
 * The `v1/live/` prefix is new and deliberate; see this module's header for
 * the three things that choice buys at once.
 */
export function liveMetricSidecarKey(params: { eventKey: string; algorithmId: string; version: string }): string {
  if (!params.version.includes("+")) {
    throw new LiveMetricSidecarVersionError(params.algorithmId, params.version);
  }
  return `v1/live/${params.eventKey}/${params.algorithmId}@${params.version}.json`;
}

/** One match's per-team metrics as the TICK holds them, before the positional encoding. */
export interface LiveMetricSidecarTickRow {
  readonly matchKey: string;
  /** The teams to encode, in the order `t` will carry them. */
  readonly teamKeys: readonly string[];
  /** teamKey -> (metric key -> raw, UNROUNDED value). Rounding happens here, once, so a sidecar value matches the publisher's rounded one exactly. */
  readonly valuesByTeam: ReadonlyMap<string, Readonly<Record<string, number>>>;
}

export interface MergeLiveMetricSidecarParams {
  /** The sidecar already in R2, or `undefined` for a genuine miss (which bootstraps) or a rejected shape (which also bootstraps — losing prior rows is the correct self-healing outcome for a corrupt sidecar). */
  readonly existing: LiveMetricSidecar | undefined;
  readonly eventKey: string;
  readonly season: number;
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  readonly computedAt: string;
  readonly complete: boolean;
  /** This tick's metric-key header, in the order values are encoded. */
  readonly metricKeys: readonly string[];
  /** This tick's newly-folded matches, in fold order. */
  readonly rows: readonly LiveMetricSidecarTickRow[];
}

export interface MergeLiveMetricSidecarResult {
  readonly sidecar: LiveMetricSidecar;
  /**
   * True when the stored `metricKeys` header differed from this tick's and the
   * stored rows were therefore DISCARDED rather than mis-aligned against a
   * header they were not encoded under. The caller logs this; it is a real
   * (bounded) loss of chart points, not a silent one.
   */
  readonly keySetDrifted: boolean;
}

function sameKeyHeader(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, i) => key === b[i]);
}

/**
 * Pure read-modify-append: this tick's rows on top of whatever is already
 * stored, returning the NEXT sidecar body. No I/O, no clock, no randomness —
 * `computedAt` and `complete` are supplied by the caller.
 *
 * Three behaviours worth stating, because each answers a real failure:
 *
 * - A row whose match key ALREADY appears is REPLACED IN PLACE, never
 *   appended a second time. `claimEventAdvance`'s compare-and-swap already
 *   makes a re-fold impossible, so this is belt-and-braces; but a duplicate
 *   `m` would double-count a match in the chart, and that is not a failure
 *   worth leaving to one guard.
 * - A DIFFERENT metric-key header discards the stored rows entirely
 *   (`keySetDrifted`). Keeping them would align old values against a new
 *   header and mislabel every number in them.
 * - Two rows appended by the SAME tick carry the same metrics record; see
 *   this module's header for why that flaw is preserved rather than fixed.
 */
export function mergeLiveMetricSidecar(params: MergeLiveMetricSidecarParams): MergeLiveMetricSidecarResult {
  const { existing, eventKey, season, algorithmId, algorithmVersion, computedAt, complete, metricKeys, rows } = params;

  const header = [...metricKeys];
  const keySetDrifted = existing !== undefined && !sameKeyHeader(existing.metricKeys, header);
  const carried: LiveMetricSidecarRow[] = existing === undefined || keySetDrifted ? [] : existing.rows.map((row) => ({ m: row.m, t: [...row.t], v: row.v.map((values) => [...values]) }));

  const indexByMatchKey = new Map(carried.map((row, index) => [row.m, index]));
  for (const row of rows) {
    const teamKeys = [...row.teamKeys];
    const encoded: LiveMetricSidecarRow = {
      m: row.matchKey,
      t: teamKeys,
      v: teamKeys.map((teamKey) => {
        const values = row.valuesByTeam.get(teamKey);
        return header.map((key) => {
          const value = values?.[key];
          return value === undefined ? null : roundMetric(value);
        });
      }),
    };
    const existingIndex = indexByMatchKey.get(row.matchKey);
    if (existingIndex === undefined) {
      indexByMatchKey.set(row.matchKey, carried.length);
      carried.push(encoded);
    } else {
      carried[existingIndex] = encoded;
    }
  }

  return {
    sidecar: {
      sidecarVersion: LIVE_METRIC_SIDECAR_VERSION,
      ephemeral: true,
      eventKey,
      season,
      algorithmId,
      algorithmVersion,
      computedAt,
      complete,
      metricKeys: header,
      rows: carried,
    },
    keySetDrifted,
  };
}

/** One decoded sidecar row for one team: the match it is the state AFTER, and that team's metric record in the shape a metric-history row carries. */
export interface LiveMetricSidecarTeamRow {
  readonly matchKey: string;
  /** Metric key -> `{ value }`. No `spread` and no `percentile` ever — see this module's header. */
  readonly metrics: Record<string, { value: number }>;
}

/**
 * Decodes the positional encoding back into per-match metric records for ONE
 * team, in sidecar (fold) order, skipping every row that team did not play.
 * A `null` value drops its key entirely rather than becoming a `0`, so an
 * absent metric renders as absence downstream exactly as it does on a
 * published row.
 *
 * This is the only decode path; the web must never index `v` itself.
 */
export function sidecarRowsForTeam(sidecar: LiveMetricSidecar, teamKey: string): LiveMetricSidecarTeamRow[] {
  const out: LiveMetricSidecarTeamRow[] = [];
  for (const row of sidecar.rows) {
    const teamIndex = row.t.indexOf(teamKey);
    if (teamIndex === -1) continue;
    const values = row.v[teamIndex];
    if (values === undefined) continue;
    const metrics: Record<string, { value: number }> = {};
    sidecar.metricKeys.forEach((key, i) => {
      const value = values[i];
      if (value !== null && value !== undefined) metrics[key] = { value };
    });
    out.push({ matchKey: row.m, metrics });
  }
  return out;
}
