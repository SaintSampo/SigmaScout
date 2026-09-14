/**
 * Statbotics' WEEK 1 population, and the single place this project writes
 * down what "week 1" means in corpus terms.
 *
 * THE OFF-BY-ONE: Statbotics' `avg.py` computes every season-level `Year`
 * aggregate (`score_mean`, `score_sd`, `no_foul_mean`, `foul_mean`, all ten
 * `comp_*_mean` slots) from matches where `m.week == 1`
 * (`docs/models/statbotics-breakdown-reference.md` §21). **This corpus
 * stores TBA's week 0-INDEXED** (`packages/corpus/schema.sql`,
 * `packages/spr/data.ts`), so **Statbotics' week 1 is this corpus's
 * `week === 0`.** Getting that backwards fails silently — the model still
 * runs and every downstream assertion still passes, just calibrated on the
 * wrong week — which is why the mapping is a named, corpus-backed-tested
 * constant rather than an inline `=== 0` at the read site.
 *
 * THE NULL-WEEK POLICY: championship, preseason and offseason events all
 * carry `week = null`, a heterogeneous bucket spanning both before and after
 * week 1. **A null-week match is never part of the week-1 population, and
 * never triggers the week-1 freeze** — it is unplaced, and treating unplaced
 * play as either would be a guess. `isStatboticsWeekOne` takes
 * `number | null` and answers `false` for `null` explicitly.
 *
 * THE FREEZE RULE: a week-1 aggregate is KNOWABLE the moment week 1 ends.
 * Matches stream in chronological order, so the FIRST match carrying a
 * numeric week greater than 0 proves every week-1 match has already passed —
 * the freeze trigger needs no lookahead, which is what makes it
 * walk-forward-legal rather than a season-final read wearing a new name.
 * Before the seal, `frozen` is `null` and every caller falls back to its
 * live expanding estimate, so a week-1 prediction can never be informed by
 * an unplayed week-1 match.
 *
 * ONE-MATCH LAG: the seal happens inside `update`, so the very first week-2
 * match of a season is predicted before its own fold seals the aggregate,
 * and still reads the live estimate (one match per season out of roughly
 * sixteen thousand). Left as-is deliberately — closing it would mean a
 * second, lazily-computed read path in `predict` that could drift.
 *
 * LATE WEEK-1 ARRIVALS: once sealed, this state ignores late-arriving week-1
 * matches (a multi-day week-0 event running into a week-1 event's start
 * date) rather than reopening — a frozen constant that keeps moving is not a
 * constant.
 *
 * This module must stay importable by the Cloudflare Worker: no Node-only
 * APIs, no better-sqlite3, no Cloudflare bindings.
 */
import {
  emptyExpandingStats,
  foldObservation,
  standardDeviation,
  type ExpandingStats,
} from "../scoring/expandingStats.js";

/**
 * The value of `UpcomingMatch.week` that corresponds to Statbotics'
 * `m.week == 1`. See this module's header for the 0-indexing evidence; do not
 * inline this as a literal anywhere, and do not "fix" it to 1.
 */
export const STATBOTICS_WEEK_ONE_CORPUS_WEEK = 0;

/**
 * True when this match belongs to the population Statbotics averages its
 * `Year` aggregates over.
 *
 * `null` (an event TBA gives no competition week for) is NOT week 1 — see the
 * null-week policy in this module's header.
 */
export function isStatboticsWeekOne(week: number | null): boolean {
  return week === STATBOTICS_WEEK_ONE_CORPUS_WEEK;
}

/** The frozen week-1 aggregate: Statbotics' `year.score_mean` / `year.score_sd` targets. */
export interface EpaWeekOneAggregate {
  readonly mean: number;
  readonly sd: number;
}

/**
 * The frozen week-1 FOUL aggregate: Statbotics' `year.get_foul_rate()` and
 * `year.no_foul_mean` targets, frozen by the same seal as `score_sd`
 * (`docs/models/statbotics-breakdown-reference.md` §21).
 *
 * `noFoulMean` is kept BESIDE the rate because the two have different
 * consumers: the rate is `predictCore`'s post-win-probability scalar, and
 * `noFoulMean` is `carryRescaleRatioFor`'s numerator.
 */
export interface EpaWeekOneFoulAggregate {
  /** `foul_mean / no_foul_mean` — `get_foul_rate()` (`year.py:176-177`). */
  readonly rate: number;
  /** `year.no_foul_mean` — the week-1 mean of `score - foulPoints - adjustPoints`. */
  readonly noFoulMean: number;
}

/**
 * League-scoped week-1 calibration state. Three facts, all flat in team
 * count, which puts them in the LEAGUE row rather than on a team row
 * (`packages/harness/stateSnapshot.ts`).
 */
export interface EpaWeekOneState {
  /** Welford accumulator over WEEK-1 alliance scores only, separate from the season-wide expanding one. */
  readonly stats: ExpandingStats;
  /** The frozen aggregate, or `null` while week 1 is still running (or if the seal found too little data). */
  readonly frozen: EpaWeekOneAggregate | null;
  /** Welford accumulator over WEEK-1 alliance NO-FOUL totals — `score - foulPoints - adjustPoints`, the quantity `avg.py` averages into `year.no_foul_mean`. */
  readonly noFoulStats: ExpandingStats;
  /**
   * Welford accumulator over WEEK-1 alliance FOUL totals —
   * `foulPoints + adjustPoints`, the quantity `avg.py` averages into
   * `year.foul_mean`. Taken as the COMPLEMENT of the no-foul side from the
   * same score, so `noFoulMean + foulMean` equals the raw score mean over the
   * same folded population by construction, and therefore
   * `(1 + rate) * noFoulMean === scoreMean` exactly.
   */
  readonly foulStats: ExpandingStats;
  /** The frozen foul record, or `null` while week 1 runs (or when the seal found no usable foul population — see `EPA_WEEK_ONE_MIN_FOUL_OBS`). */
  readonly frozenFoul: EpaWeekOneFoulAggregate | null;
  /** Whether the freeze has already been ATTEMPTED. Distinct from `frozen !== null`: a seal that found too little data is sealed with nothing frozen, and must not be retried. */
  readonly sealed: boolean;
}

/**
 * Minimum week-1 alliance-score observations before a freeze takes effect.
 *
 * 2 is `standardDeviation`'s own contract boundary — below it there is no
 * variance to report at all. This is a legality floor, not a tuned threshold:
 * nothing was searched, and no value was chosen by looking at an accuracy
 * number.
 */
export const EPA_WEEK_ONE_MIN_OBS = 2;

/**
 * Minimum week-1 FOUL/NO-FOUL observations before a foul-rate freeze takes
 * effect.
 *
 * 1 is a MEAN's own contract boundary, exactly as `EPA_WEEK_ONE_MIN_OBS = 2`
 * above is `standardDeviation`'s. A SEPARATE constant from
 * `EPA_WEEK_ONE_MIN_OBS` deliberately: the two gates govern different
 * records with different mathematical requirements.
 */
export const EPA_WEEK_ONE_MIN_FOUL_OBS = 1;

/**
 * The foul rate used when no usable week-1 foul information exists.
 *
 * 0 means "publish each alliance's plain no-foul total" — the identity
 * element of the `(1 + rate)` scalar. NOT a tuned value.
 *
 * Upstream's own guard is weaker: `get_foul_rate()` returns `(self.foul_mean
 * or 0) / (self.no_foul_mean or 1)`, substituting a denominator of 1 and
 * publishing `foul_mean` ITSELF as a rate when the no-foul mean is missing.
 * This project refuses the divide instead.
 */
export const EPA_FALLBACK_FOUL_RATE = 0;

const EMPTY_WEEK_ONE_STATE: EpaWeekOneState = {
  stats: emptyExpandingStats(),
  frozen: null,
  noFoulStats: emptyExpandingStats(),
  foulStats: emptyExpandingStats(),
  frozenFoul: null,
  sealed: false,
};

export function emptyEpaWeekOneState(): EpaWeekOneState {
  return EMPTY_WEEK_ONE_STATE;
}

/**
 * Folds one alliance score into the week-1 accumulator, if and only if the
 * match belongs to Statbotics' week-1 population AND the aggregate has not
 * already been sealed.
 *
 * Never mutates its input. A non-finite score is dropped rather than folded —
 * one `NaN` would poison the whole aggregate and every prediction downstream of
 * it, silently.
 */
export function foldWeekOneAllianceScore(state: EpaWeekOneState, week: number | null, score: number): EpaWeekOneState {
  if (state.sealed) return state;
  if (!isStatboticsWeekOne(week)) return state;
  if (!Number.isFinite(score)) return state;
  return { ...state, stats: foldObservation(state.stats, score) };
}

/**
 * Folds one alliance's NO-FOUL / FOUL split into the week-1 accumulators,
 * under exactly the gates `foldWeekOneAllianceScore` above applies.
 *
 * Both values are dropped together when either is non-finite, deliberately:
 * they are two halves of ONE observation of one alliance's score, and
 * folding half of it would break the `noFoulMean + foulMean === scoreMean`
 * identity the complement construction exists to guarantee.
 *
 * The CALLER owns the two exclusions this function cannot see — a
 * ruling-zero alliance and an alliance whose breakdown did not parse
 * (`epa.ts`'s `update`). This function only knows about weeks and finiteness.
 */
export function foldWeekOneFoulSplit(
  state: EpaWeekOneState,
  week: number | null,
  noFoul: number,
  foul: number
): EpaWeekOneState {
  if (state.sealed) return state;
  if (!isStatboticsWeekOne(week)) return state;
  if (!Number.isFinite(noFoul) || !Number.isFinite(foul)) return state;
  return {
    ...state,
    noFoulStats: foldObservation(state.noFoulStats, noFoul),
    foulStats: foldObservation(state.foulStats, foul),
  };
}

/**
 * `get_foul_rate()`'s ratio, with this project's guards: `foul_mean /
 * no_foul_mean`, or `null` when the quantity is not one a prediction may be
 * multiplied by.
 *
 * THE ONE DIVIDE — both the seal below and `epa.ts`'s live pre-seal read
 * call this, so a second copy of the ratio can never drift from the first.
 *
 * Refused, rather than fudged:
 *   - a non-finite input on either side;
 *   - a no-foul mean that is not strictly positive — the degenerate divide
 *     upstream papers over with `(self.no_foul_mean or 1)`;
 *   - a negative foul mean, which would DEFLATE both published scores; the
 *     sport cannot produce one, so it is a defect to refuse.
 *
 * A rate of exactly 0 is a real answer: no foul points were observed. Only
 * `null` means "unusable".
 */
export function foulRateFrom(noFoulMean: number, foulMean: number): number | null {
  if (!Number.isFinite(noFoulMean) || !Number.isFinite(foulMean)) return null;
  if (noFoulMean <= 0) return null;
  if (foulMean < 0) return null;
  const rate = foulMean / noFoulMean;
  if (!Number.isFinite(rate) || rate < 0) return null;
  return rate;
}

/**
 * Seals the week-1 aggregate the first time a match proves week 1 is over.
 *
 * `week === null` never seals (unplaced play is neither week 1 nor after
 * it), and `week === 0` never seals (that IS week 1). A seal that finds
 * fewer than `EPA_WEEK_ONE_MIN_OBS` observations, or a non-finite or
 * non-positive spread, records `sealed` and leaves `frozen` at `null` — a
 * zero SD would make the logistic scale infinite, a defect to refuse.
 *
 * ONE SEAL MOMENT, TWO RECORDS. `frozen` (mean/sd) and `frozenFoul`
 * (rate/no-foul mean) are frozen in this one call, from the same week-1
 * population. Their GATES are independent on purpose: `EPA_WEEK_ONE_MIN_OBS`
 * (2) is `standardDeviation`'s contract and governs `frozen`;
 * `EPA_WEEK_ONE_MIN_FOUL_OBS` (1) is a mean's and governs `frozenFoul`.
 * Either may come out `null` while the other freezes.
 */
export function sealWeekOneIfPast(state: EpaWeekOneState, week: number | null): EpaWeekOneState {
  if (state.sealed) return state;
  if (week === null || !Number.isFinite(week) || week <= STATBOTICS_WEEK_ONE_CORPUS_WEEK) return state;

  const frozenFoul = sealFoulRecord(state);

  if (state.stats.count < EPA_WEEK_ONE_MIN_OBS) return { ...state, frozenFoul, sealed: true };
  const mean = state.stats.mean;
  const sd = standardDeviation(state.stats, Number.NaN);
  if (!Number.isFinite(mean) || !Number.isFinite(sd) || sd <= 0) return { ...state, frozenFoul, sealed: true };
  return { ...state, frozen: { mean, sd }, frozenFoul, sealed: true };
}

/**
 * The `frozenFoul` half of the seal above. Returns `null` — not a
 * substituted value — whenever the week-1 foul population cannot produce a
 * rate a prediction may be multiplied by.
 */
function sealFoulRecord(state: EpaWeekOneState): EpaWeekOneFoulAggregate | null {
  if (state.noFoulStats.count < EPA_WEEK_ONE_MIN_FOUL_OBS) return null;
  if (state.foulStats.count < EPA_WEEK_ONE_MIN_FOUL_OBS) return null;
  const noFoulMean = state.noFoulStats.mean;
  const rate = foulRateFrom(noFoulMean, state.foulStats.mean);
  if (rate === null) return null;
  return { rate, noFoulMean };
}
