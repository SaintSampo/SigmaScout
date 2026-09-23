/**
 * THE LIVE EVENT ROWS — the per-match, per-team post-match metrics a live tick
 * carried INSIDE the event artifact it already read and wrote exactly once per
 * tick (quick task 260918-16t).
 *
 * DEPRECATED, WHOLE FILE, FOR QUICK TASK 260923-3w7. NOTHING PRODUCES A `live`
 * BLOCK any more: quick task 260923-3w6 reinstated the tick's own per-team
 * artifact write (`260923-1tu-FINDINGS.md` item C5), which is the thing this
 * block existed to avoid, so `mergeEventLiveBlock` has no production caller and
 * neither trim constant can fire. The file survives only because the WEB still
 * DECODES a block it may find in R2 (`liveRowsForTeam`, read by the team-season
 * overlay) and because two parity tests build blocks as fixtures. 260923-3w7
 * deletes the overlay, and this file goes with it. Do not add a producer.
 *
 * WHAT IT IS FOR, and why it is not a separate object any more. A live tick
 * used to read and rewrite one `v1/team/...` artifact per touched team per
 * algorithm — twelve whole season artifacts on an ordinary tick, 7.6 ms of a
 * 17.5 ms Phase B. Quick task 260917-jr4 replaced that with ONE small
 * ephemeral sidecar object per algorithm-event, and MEASURED IT AT 9.5 ± 1.7
 * ms — MORE than the team writes it replaced, because a sidecar is
 * read-modify-append: a second whole-body parse and a second stringify per
 * tick, plus two subrequests. This module carries exactly the same rows in
 * exactly the same encoding, inside a body the tick is ALREADY parsing and
 * ALREADY stringifying, where the marginal cost is bytes rather than a second
 * object.
 *
 * HOW IT IS MARKED EPHEMERAL — a STRUCTURAL guarantee, not a convention and
 * not an `ephemeral: true` literal. `LiveEventArtifactSchema` declares `live`;
 * `EventArtifactSchema` does NOT. The offline publisher writes through
 * `EventArtifactSchema`, and zod objects strip unknown keys, so the next
 * republish of an event DROPS the block on the floor with no publisher change
 * and no delete call anywhere. That asymmetry is the whole mechanism; it is
 * pinned by a test in `pageArtifacts.test.ts`.
 *
 * NODE-FREE, for the same reason `metricHistorySchema.ts` is split out: this
 * module sits on the BROWSER's import graph (the robot page and the match page
 * both decode live rows during a live event) and on the read-only state
 * probe's, neither of which may pull in a Node-only or write-capable module.
 * It imports `zod` only transitively, through `pageArtifacts.js` — which is
 * itself browser-safe and already on the web's graph — plus `./rounding.js`.
 * The two trim constants are IMPORTED from `pageArtifacts.js` rather than
 * re-declared here so they cannot drift from the schema that documents them.
 * `packages/harness/publishBudget.ts` imports `node:path` and must never enter
 * this graph.
 *
 * WHAT TRAVELS AND WHAT DELIBERATELY DOES NOT: see `EventLiveRowSchema`'s own
 * doc comment in `pageArtifacts.ts`. In short — values only, rounded through
 * `roundMetric` at encode time so a live value matches the publisher's rounded
 * one exactly; no `spread`, no `percentile`, no `matchIndex`; and
 * `SIGMA_METRIC_KEY` is an ordinary member of the header with no special case
 * anywhere in the encoding.
 *
 * THE BLOCK DROPS EIGHT OF THE SIDECAR'S WRAPPER FIELDS as redundant, because
 * the event artifact already carries every one of them at top level:
 * `sidecarVersion`, `ephemeral`, `eventKey`, `season`, `algorithmId`,
 * `algorithmVersion`, `computedAt` and `complete`. Nothing ever read
 * `complete`. The block is therefore exactly `{ metricKeys, rows }`.
 *
 * ONE PRESERVED FLAW, NAMED RATHER THAN INTRODUCED. A tick that folds TWO
 * matches at once writes two rows carrying the SAME end-of-tick metrics
 * record, because the tick reads `touchedMetrics` once. That is exactly what
 * `mergeTeamSeasonArtifact` has always done (its `matches.map` reuses one
 * `metrics` record for every row it appends). This module carries the flaw
 * forward unchanged and does not fix it: fixing it would change published
 * numbers and therefore needs its own algorithm version bump.
 *
 * LIFECYCLE. Created by the first tick that folds a match at the event,
 * read-modify-appended on every tick that folds thereafter, and never deleted
 * by the Worker — the next republish strips it (see above), and until then
 * every row it carries that the publisher has already seen is a duplicate the
 * browser drops by match key.
 *
 * STALENESS, without a generation check. The tick's own `stamp.generation` is
 * `tick-{nowMs}`, invented per tick and never the publisher's, so comparing
 * generations against a published artifact is structurally impossible. Two
 * exact guards replace it, both carried forward unchanged: the VERSION SEGMENT
 * OF THE EVENT ARTIFACT'S OWN KEY (a model change ships under a new key, so a
 * superseded model's rows are a 404, not a bad merge) and MATCH-KEY DEDUP in
 * the consumer (a row for a match the published history already covers is
 * redundant by construction and is dropped whether it is stale or fresh).
 */
import { roundMetric } from "./rounding.js";
import {
  EVENT_LIVE_BLOCK_TRIM_RETAIN_ROWS,
  EVENT_LIVE_BLOCK_TRIM_THRESHOLD_BYTES,
  type EventLiveBlock,
  type EventLiveRow,
} from "./pageArtifacts.js";

/** One match's per-team metrics as the TICK holds them, before the positional encoding. */
export interface EventLiveTickRow {
  readonly matchKey: string;
  /** The teams to encode, in the order `t` will carry them. */
  readonly teamKeys: readonly string[];
  /** teamKey -> (metric key -> raw, UNROUNDED value). Rounding happens at encode time, once, so a live value matches the publisher's rounded one exactly. */
  readonly valuesByTeam: ReadonlyMap<string, Readonly<Record<string, number>>>;
}

export interface MergeEventLiveBlockParams {
  /** The block on the event artifact this tick read, or `undefined` for an event with no live rows yet (which bootstraps) or a block the shape guard removed (which also bootstraps). */
  readonly existing: EventLiveBlock | undefined;
  /** This tick's metric-key header, in the order values are encoded. Sorted by the builder; see `buildTickLiveRows`. */
  readonly metricKeys: readonly string[];
  /** This tick's newly-folded matches, in fold order. */
  readonly rows: readonly EventLiveTickRow[];
  /**
   * The byte length of the event body AS READ FROM R2 this tick — `.length`
   * of the text the tick already holds, never a re-serialization. Drives the
   * trim guard; see `EVENT_LIVE_BLOCK_TRIM_THRESHOLD_BYTES`.
   */
  readonly existingBodyBytes: number;
}

export interface MergeEventLiveBlockResult {
  readonly block: EventLiveBlock;
  /**
   * True when the stored `metricKeys` header differed from this tick's and the
   * stored rows were therefore DISCARDED rather than mis-aligned against a
   * header they were not encoded under. The caller logs this; it is a real
   * (bounded) loss of chart points, not a silent one. The count lost is the
   * caller's own `existing.rows.length` — this result reports the FACT, and
   * `droppedRows` is reserved for the trim so a log line can never conflate
   * the two causes.
   */
  readonly keySetDrifted: boolean;
  /**
   * How many rows the SIZE TRIM discarded (0 when it did not fire). Never
   * includes rows lost to `keySetDrifted` — two different failures with two
   * different remedies deserve two different numbers.
   */
  readonly droppedRows: number;
}

function sameKeyHeader(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, i) => key === b[i]);
}

/**
 * Pure read-modify-append: this tick's rows on top of whatever the fetched
 * event artifact already carried, returning the NEXT block. No I/O, no clock,
 * no randomness.
 *
 * CARRIED ROWS ARE CARRIED BY REFERENCE, not deep-copied, and that is a
 * measured decision rather than a style preference. The sidecar this replaces
 * deep-copied every carried row on every tick (`row.v.map(values => [...values])`)
 * — roughly 4,400 small array allocations per tick at 147 rows — and that
 * allocation churn is a live suspect for the 9.5 ms the sidecar measured.
 * A row is CONSTRUCTED ONCE below and never mutated afterwards by anything in
 * this module, by the merge that embeds it, or by `liveRowsForTeam`, which
 * only reads. The only copy made here is of the ARRAY (`[...existing.rows]`),
 * one allocation, so the caller's fetched object is not mutated in place.
 *
 * Four behaviours worth stating, because each answers a real failure:
 *
 * - A row whose match key ALREADY appears is REPLACED IN PLACE, never appended
 *   a second time. `claimEventAdvance`'s compare-and-swap already makes a
 *   re-fold impossible, so this is belt-and-braces; but a duplicate `m` would
 *   double-count a match in the chart, and that is not a failure worth leaving
 *   to one guard.
 * - A DIFFERENT metric-key header discards the stored rows entirely
 *   (`keySetDrifted`). Keeping them would align old values against a new
 *   header and mislabel every number in them.
 * - A fetched body already over `EVENT_LIVE_BLOCK_TRIM_THRESHOLD_BYTES`
 *   retains only the most recent `EVENT_LIVE_BLOCK_TRIM_RETAIN_ROWS` rows and
 *   reports how many it dropped. Never a throw: a throw would lose this tick's
 *   rows permanently, because the event cursor has already advanced.
 * - Two rows appended by the SAME tick carry the same metrics record; see this
 *   module's header for why that flaw is preserved rather than fixed.
 */
export function mergeEventLiveBlock(params: MergeEventLiveBlockParams): MergeEventLiveBlockResult {
  const { existing, metricKeys, rows, existingBodyBytes } = params;

  const header = [...metricKeys];
  const keySetDrifted = existing !== undefined && !sameKeyHeader(existing.metricKeys, header);
  // BY REFERENCE — see this function's doc comment. One array allocation, and
  // every carried row is the very object the fetched body already holds.
  const carried: EventLiveRow[] = existing === undefined || keySetDrifted ? [] : [...existing.rows];

  const indexByMatchKey = new Map(carried.map((row, index) => [row.m, index]));
  for (const row of rows) {
    const teamKeys = [...row.teamKeys];
    const encoded: EventLiveRow = {
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

  let droppedRows = 0;
  let retained = carried;
  if (existingBodyBytes > EVENT_LIVE_BLOCK_TRIM_THRESHOLD_BYTES && carried.length > EVENT_LIVE_BLOCK_TRIM_RETAIN_ROWS) {
    droppedRows = carried.length - EVENT_LIVE_BLOCK_TRIM_RETAIN_ROWS;
    retained = carried.slice(droppedRows);
  }

  return { block: { metricKeys: header, rows: retained }, keySetDrifted, droppedRows };
}

/** One decoded live row for one team: the match it is the state AFTER, and that team's metric record in the shape a metric-history row carries. */
export interface EventLiveTeamRow {
  readonly matchKey: string;
  /** Metric key -> `{ value }`. No `spread` and no `percentile` ever — see `EventLiveRowSchema`'s doc comment. */
  readonly metrics: Record<string, { value: number }>;
}

/**
 * Decodes the positional encoding back into per-match metric records for ONE
 * team, in fold order, skipping every row that team did not play. A `null`
 * value drops its key entirely rather than becoming a `0`, so an absent metric
 * renders as absence downstream exactly as it does on a published row.
 *
 * This is the ONLY decode path; no consumer may index `v` itself.
 */
export function liveRowsForTeam(block: EventLiveBlock, teamKey: string): EventLiveTeamRow[] {
  const out: EventLiveTeamRow[] = [];
  for (const row of block.rows) {
    const teamIndex = row.t.indexOf(teamKey);
    if (teamIndex === -1) continue;
    const values = row.v[teamIndex];
    if (values === undefined) continue;
    const metrics: Record<string, { value: number }> = {};
    block.metricKeys.forEach((key, i) => {
      const value = values[i];
      if (value !== null && value !== undefined) metrics[key] = { value };
    });
    out.push({ matchKey: row.m, metrics });
  }
  return out;
}
