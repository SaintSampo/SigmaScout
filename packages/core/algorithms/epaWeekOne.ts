/**
 * Statbotics' WEEK 1 population, and the single place this project writes
 * down what "week 1" means in corpus terms (quick task 260911-j2w Task 2).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MODULE EXISTS: THE OFF-BY-ONE
 * ---------------------------------------------------------------------------
 * `backend/src/data/avg.py` computes EVERY season-level `Year` aggregate
 * Statbotics reads — `score_mean`, `score_sd`, `no_foul_mean`, `foul_mean`,
 * and all ten `comp_*_mean` slots — from one filtered list
 * (`docs/models/statbotics-breakdown-reference.md` §20, verbatim):
 *
 *     week_one_matches = [
 *         m for m in matches if m.week == 1 and m.status == MatchStatus.COMPLETED
 *     ]
 *
 * Its filter is `week == 1`. **This corpus stores TBA's week 0-INDEXED**:
 * `packages/corpus/schema.sql` and `packages/bpr/data.ts` both record that
 * corpus week 0 is competition "Week 1", and the corpus itself confirms it —
 * 2024's `week = 0` events run 2024-02-24 to 2024-03-03, which is FRC's own
 * Week 1, while `week = 1` events do not begin until 2024-03-05.
 *
 * So **Statbotics' week 1 is this corpus's `week === 0`.**
 *
 * Getting that backwards is the whole risk of adopting these constants,
 * because nothing visibly fails when you do. The model still runs, the
 * ratings still look plausible, every downstream assertion still passes, and
 * the reproduction is silently calibrated on the wrong week. That is why the
 * mapping is a named constant with a corpus-backed test
 * (`epaWeekOne.test.ts`) rather than an inline `=== 0` at the read site.
 *
 * ---------------------------------------------------------------------------
 * THE NULL-WEEK POLICY
 * ---------------------------------------------------------------------------
 * Championship, preseason and offseason events all carry `week = null` in this
 * corpus. In 2024 that is 143 events and 6,255 played matches, and the bucket
 * is HETEROGENEOUS: its start dates span 2024-02-03 to 2024-12-27, so some
 * null-week play happens BEFORE week 1 and some happens long after.
 *
 * **A null-week match is never part of the week-1 population, and never
 * triggers the week-1 freeze.** It is neither week 1 nor "after week 1"; it is
 * unplaced, and treating unplaced play as either would be a guess. Every
 * consumer of this module must apply that rule, which is why
 * `isStatboticsWeekOne` takes `number | null` rather than `number` and
 * answers `false` for `null` explicitly.
 *
 * ---------------------------------------------------------------------------
 * THE FREEZE RULE, AND WHY IT IS WALK-FORWARD LEGAL (quick task 260911-j2w
 * Task 3)
 * ---------------------------------------------------------------------------
 * A week-1 aggregate is KNOWABLE the moment week 1 ends. Reading it for any
 * week-2-or-later match therefore reads nothing that has not already been
 * played, which is what narrows this whole class of divergence from a
 * season-wide problem to a one-week one
 * (`docs/models/statbotics-breakdown-reference.md` §20).
 *
 * Matches stream in chronological order, so the FIRST match carrying a numeric
 * week greater than 0 proves every week-1 match has already passed. That is the
 * freeze trigger, and it needs no lookahead — which is precisely what makes
 * this a walk-forward-legal refinement rather than a season-final read wearing
 * a new name.
 *
 * DURING WEEK 1 ITSELF the frozen value does not exist, and every caller falls
 * back to its live expanding estimate. So a week-1 prediction can never be
 * informed by a week-1 match that has not been played yet. That is the whole
 * safety argument, and it is why `frozen` is `null` rather than a partial
 * aggregate before the seal.
 *
 * ONE-MATCH LAG, stated rather than hidden. The seal happens inside `update`,
 * so the very first week-2 match of a season is PREDICTED before its own fold
 * seals the aggregate, and therefore still reads the live estimate. One match
 * per season out of roughly sixteen thousand. It is left as-is deliberately:
 * closing it would mean a second, lazily-computed read path in `predict` that
 * could drift from the sealed value.
 *
 * LATE WEEK-1 ARRIVALS. Week-0 and week-1 EVENT windows never overlap by start
 * date in any corpus season (pinned by `epaWeekOne.test.ts`), but a multi-day
 * week-0 event can still run a match on the day a week-1 event opens. Once
 * sealed, this state ignores such arrivals entirely rather than reopening: a
 * frozen constant that keeps moving is not a constant, and every prediction
 * already made against it would be inconsistent with every later one. The cost
 * is that the aggregate can cover slightly fewer matches than Statbotics'
 * offline `week_one_matches` list, which is a named consequence of being
 * walk-forward rather than offline.
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
 * League-scoped week-1 calibration state. Three facts, all flat in team count,
 * which is the D-13 rule that puts them in the LEAGUE row rather than on a team
 * row (`packages/harness/stateSnapshot.ts`'s 10 -> 11 and 11 -> 12 blocks).
 */
export interface EpaWeekOneState {
  /** Welford accumulator over WEEK-1 alliance scores only, separate from the season-wide expanding one. */
  readonly stats: ExpandingStats;
  /** The frozen aggregate, or `null` while week 1 is still running (or if the seal found too little data). */
  readonly frozen: EpaWeekOneAggregate | null;
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

const EMPTY_WEEK_ONE_STATE: EpaWeekOneState = {
  stats: emptyExpandingStats(),
  frozen: null,
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
 * Seals the week-1 aggregate the first time a match proves week 1 is over.
 *
 * `week === null` never seals (the null-week policy above: unplaced play is
 * neither week 1 nor after it), and `week === 0` never seals (that IS week 1).
 * A seal that finds fewer than `EPA_WEEK_ONE_MIN_OBS` observations, or a
 * non-finite or non-positive spread, records `sealed` and leaves `frozen` at
 * `null` — the caller keeps its live estimate, and the state says so rather
 * than handing back a degenerate constant. A zero SD would make the logistic
 * scale infinite; that is a defect to refuse, not a number to ship.
 */
export function sealWeekOneIfPast(state: EpaWeekOneState, week: number | null): EpaWeekOneState {
  if (state.sealed) return state;
  if (week === null || !Number.isFinite(week) || week <= STATBOTICS_WEEK_ONE_CORPUS_WEEK) return state;
  if (state.stats.count < EPA_WEEK_ONE_MIN_OBS) return { ...state, sealed: true };
  const mean = state.stats.mean;
  const sd = standardDeviation(state.stats, Number.NaN);
  if (!Number.isFinite(mean) || !Number.isFinite(sd) || sd <= 0) return { ...state, sealed: true };
  return { ...state, frozen: { mean, sd }, sealed: true };
}
