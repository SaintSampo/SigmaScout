/**
 * GBR's season-transfer core: per-team/per-season walk-forward state, the 25
 * enumerated match features (P-9), and the antisymmetry machinery that makes
 * a match's prediction independent of which alliance is called "red".
 *
 * Ship 25 features, not the brief's "~40" estimate — precision beats
 * matching the estimate. The count and the 8-entry symmetric mask are both
 * pinned by EQUALITY in `features.test.ts`, never by iteration (this repo
 * has been bitten three times by tests that iterate a hardcoded list and
 * silently skip a new entry).
 *
 * `extractFeatures` reads NO outcome field, ever — only `redTeams`,
 * `blueTeams`, `compLevel`, and `eventType`, none of which are outcome-
 * bearing (see `packages/core/algorithms/types.ts`'s `UpcomingMatch` doc
 * comments). `updateStates` is the only function in this file that reads
 * `winner` / `redScore` / `blueScore` / `scoreBreakdownRaw`.
 */
import {
  componentGroupsForSeason,
  tryParseBreakdownPair,
  type ParsedComponents,
  type SeasonComponentGroups,
} from "../core/algorithms/breakdown/index.js";
import { eventClassOf, type GbrMatch } from "./data.js";

/** P-9: tuning knobs threaded from the caller, never baked in as constants. */
export interface FeatureParams {
  /** EWMA half-life in matches. Tunable {5, 10, 20}, default 10. */
  halflife: number;
  /** Season-boundary decay applied to `prevSeasonRating`. Tunable {0.3, 0.6, 0.9}, default 0.6. */
  prevSeasonDecay: number;
}

export const DEFAULT_FEATURE_PARAMS: FeatureParams = { halflife: 10, prevSeasonDecay: 0.6 };

/** P-9's 14 per-team state fields (t0..t13), plus event/season bookkeeping. */
interface TeamState {
  scoreZEwma: number; // t0
  marginZEwma: number; // t1
  winEwma: number; // t2
  scoreZSum: number; // backs t3 (scoreZMean = scoreZSum / matchCount)
  marginZSum: number; // backs t4
  winSum: number; // backs t5
  autoShareEwma: number; // t6
  teleopShareEwma: number; // t7
  endgameShareEwma: number; // t8
  oppStrengthEwma: number; // t9
  prevSeasonRating: number; // t10
  veteranSeasons: number; // t11
  matchCount: number; // t12
  matchesThisEvent: number; // t13
  currentEventKey: string | null;
  /** Boundary bookkeeping only — did this team play >=1 match this season. */
  playedThisSeason: boolean;
}

const DEFAULT_TEAM: Readonly<TeamState> = Object.freeze({
  scoreZEwma: 0,
  marginZEwma: 0,
  winEwma: 0,
  scoreZSum: 0,
  marginZSum: 0,
  winSum: 0,
  autoShareEwma: 0,
  teleopShareEwma: 0,
  endgameShareEwma: 0,
  oppStrengthEwma: 0,
  prevSeasonRating: 0,
  veteranSeasons: 0,
  matchCount: 0,
  matchesThisEvent: 0,
  currentEventKey: null,
  playedThisSeason: false,
});

export interface SeasonState {
  season: number;
  /** Welford accumulator over ALLIANCE SCORES (each match contributes two observations). */
  count: number;
  mean: number;
  M2: number;
  teams: Map<string, TeamState>;
  /**
   * Cumulative over the package's whole lifetime, never reset by
   * `carrySeason` — mirrors `BreakdownParseTelemetry`'s convention
   * (`core/algorithms/types.ts`). Two SEPARATE counters (P-9's action item
   * 3) because "absent" (TBA sent no breakdown) and "malformed" (TBA sent
   * one that failed the season's schema) are different data-quality facts.
   */
  absentBreakdownCount: number;
  malformedBreakdownCount: number;
}

export function initSeasonState(season: number): SeasonState {
  return { season, count: 0, mean: 0, M2: 0, teams: new Map(), absentBreakdownCount: 0, malformedBreakdownCount: 0 };
}

/** `seasonSd = max(sqrt(M2 / (count - 1)), 1)`, with `count < 2` falling back to 1. */
export function seasonSd(state: SeasonState): number {
  if (state.count < 2) return 1;
  return Math.max(Math.sqrt(state.M2 / (state.count - 1)), 1);
}

function foldWelford(state: SeasonState, x: number): void {
  state.count += 1;
  const delta = x - state.mean;
  state.mean += delta / state.count;
  const delta2 = x - state.mean;
  state.M2 += delta * delta2;
}

function getOrCreateTeam(state: SeasonState, key: string): TeamState {
  let t = state.teams.get(key);
  if (t === undefined) {
    t = { ...DEFAULT_TEAM };
    state.teams.set(key, t);
  }
  return t;
}

function readTeam(state: SeasonState, key: string): TeamState {
  return state.teams.get(key) ?? DEFAULT_TEAM;
}

function alphaFor(halflife: number): number {
  return 1 - 0.5 ** (1 / halflife);
}

function ewma(prev: number, x: number, alpha: number): number {
  return prev + alpha * (x - prev);
}

// --- P-9 feature enumeration -------------------------------------------------

/**
 * 25 features, enumerated. f0..f16 are `A_red[i] - A_blue[i]` for the 17
 * per-alliance aggregate values (negate on an alliance swap); f17..f24 are
 * symmetric context (unchanged on a swap). Order matches the plan's table
 * exactly.
 */
export const FEATURE_NAMES: readonly string[] = Object.freeze([
  "scoreZEwmaDiff", // f0  <- a0 diff (mean t0)
  "marginZEwmaDiff", // f1  <- a1 diff (mean t1)
  "winEwmaDiff", // f2  <- a2 diff (mean t2)
  "scoreZMeanDiff", // f3  <- a3 diff (mean t3)
  "marginZMeanDiff", // f4  <- a4 diff (mean t4)
  "winMeanDiff", // f5  <- a5 diff (mean t5)
  "autoShareEwmaDiff", // f6  <- a6 diff (mean t6)
  "teleopShareEwmaDiff", // f7  <- a7 diff (mean t7)
  "endgameShareEwmaDiff", // f8  <- a8 diff (mean t8)
  "oppStrengthEwmaDiff", // f9  <- a9 diff (mean t9)
  "prevSeasonRatingDiff", // f10 <- a10 diff (mean t10)
  "veteranSeasonsDiff", // f11 <- a11 diff (mean t11)
  "matchCountDiff", // f12 <- a12 diff (mean t12)
  "matchesThisEventDiff", // f13 <- a13 diff (mean t13)
  "marginZEwmaMinDiff", // f14 <- a14 diff (min t1)
  "marginZEwmaMaxDiff", // f15 <- a15 diff (max t1)
  "coldStartFlagDiff", // f16 <- a16 diff (cold-start flag)
  "isElim", // f17 - symmetric
  "eventClassRegional", // f18 - symmetric
  "eventClassDistrict", // f19 - symmetric
  "eventClassChamps", // f20 - symmetric
  "eventClassOffseason", // f21 - symmetric
  "meanMatchesThisEventAllSix", // f22 - symmetric
  "meanMatchCountAllSix", // f23 - symmetric
  "bothColdStart", // f24 - symmetric
]);

/** True for a symmetric (context) feature, false for one that negates on an alliance swap. Exactly 8 true entries (f17..f24). */
export const SYMMETRIC: readonly boolean[] = Object.freeze(FEATURE_NAMES.map((_, i) => i >= 17));

/** Applies the `SYMMETRIC` mask: negates every non-symmetric feature, leaves symmetric ones untouched. */
export function negateFeatures(x: Float64Array): Float64Array {
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i += 1) {
    const v = x[i] ?? 0;
    out[i] = SYMMETRIC[i] === true ? v : -v;
  }
  return out;
}

/** Per-team `t0..t13` read as a plain array, computing the two running-mean fields (t3/t4) from their backing sums. Read-only: never mutates `t`. */
function teamVector(t: TeamState): number[] {
  const n = t.matchCount;
  return [
    t.scoreZEwma,
    t.marginZEwma,
    t.winEwma,
    n > 0 ? t.scoreZSum / n : 0,
    n > 0 ? t.marginZSum / n : 0,
    n > 0 ? t.winSum / n : 0,
    t.autoShareEwma,
    t.teleopShareEwma,
    t.endgameShareEwma,
    t.oppStrengthEwma,
    t.prevSeasonRating,
    t.veteranSeasons,
    t.matchCount,
    t.matchesThisEvent,
  ];
}

/** Per-alliance aggregate: a0..a13 = mean of t0..t13, a14 = min(t1), a15 = max(t1), a16 = cold-start flag. */
function allianceAggregate(state: SeasonState, teamKeys: readonly string[]): number[] {
  const n = teamKeys.length;
  const sums = new Array<number>(14).fill(0);
  let minMarginZ = Infinity;
  let maxMarginZ = -Infinity;
  let allCold = true;
  for (const key of teamKeys) {
    const t = readTeam(state, key);
    const vec = teamVector(t);
    for (let i = 0; i < 14; i += 1) sums[i] = (sums[i] ?? 0) + (vec[i] ?? 0);
    const marginZ = vec[1] ?? 0;
    if (marginZ < minMarginZ) minMarginZ = marginZ;
    if (marginZ > maxMarginZ) maxMarginZ = marginZ;
    if (t.matchCount >= 6) allCold = false;
  }
  const a = new Array<number>(17).fill(0);
  for (let i = 0; i < 14; i += 1) a[i] = n > 0 ? (sums[i] ?? 0) / n : 0;
  a[14] = n > 0 ? minMarginZ : 0;
  a[15] = n > 0 ? maxMarginZ : 0;
  a[16] = n > 0 && allCold ? 1 : 0;
  return a;
}

/**
 * Reads no outcome field, ever — only `redTeams`, `blueTeams`, `compLevel`,
 * `eventType`, and (for error messages only) `matchKey`. Returns 25 finite
 * values in `FEATURE_NAMES` order, asserting finiteness before returning
 * (`assertFiniteComponents`'s discipline — `breakdown/constants.ts`).
 *
 * Uses the PRE-update season stats (`seasonSd(state)`/`state.mean` as they
 * stand when this is called) — the asymmetry with `updateStates`, which uses
 * the POST-update stats, is deliberate: it is what makes the label computed
 * for this same match share one normalization with the features extracted
 * for it.
 */
export function extractFeatures(state: SeasonState, match: GbrMatch): Float64Array {
  if (match.redTeams.length === 0 || match.blueTeams.length === 0) {
    throw new Error(
      `extractFeatures: match ${match.matchKey} has an empty alliance — the caller must skip it ` +
        `(P-9's skippedNoTeams counter) before calling extractFeatures`,
    );
  }

  const redA = allianceAggregate(state, match.redTeams);
  const blueA = allianceAggregate(state, match.blueTeams);

  const out = new Float64Array(25);
  for (let i = 0; i < 17; i += 1) {
    out[i] = (redA[i] ?? 0) - (blueA[i] ?? 0);
  }

  out[17] = match.compLevel !== "qm" ? 1 : 0;
  const cls = eventClassOf(match.eventType);
  out[18] = cls === "regional" ? 1 : 0;
  out[19] = cls === "district" ? 1 : 0;
  out[20] = cls === "champs" ? 1 : 0;
  out[21] = cls === "offseason" ? 1 : 0;

  const allTeams: string[] = [...match.redTeams, ...match.blueTeams];
  let sumT13 = 0;
  let sumT12 = 0;
  let allCold = true;
  for (const key of allTeams) {
    const t = readTeam(state, key);
    sumT13 += t.matchesThisEvent;
    sumT12 += t.matchCount;
    if (t.matchCount >= 6) allCold = false;
  }
  out[22] = allTeams.length > 0 ? sumT13 / allTeams.length : 0;
  out[23] = allTeams.length > 0 ? sumT12 / allTeams.length : 0;
  out[24] = allTeams.length > 0 && allCold ? 1 : 0;

  for (let i = 0; i < 25; i += 1) {
    const v = out[i];
    if (v === undefined || !Number.isFinite(v)) {
      throw new Error(
        `extractFeatures: non-finite value ${String(v)} for feature "${FEATURE_NAMES[i]}" in match ${match.matchKey}`,
      );
    }
  }

  return out;
}

// --- group shares (P-1, P-8) -------------------------------------------------

interface Shares {
  autoShare: number;
  teleopShare: number;
  endgameShare: number;
}

function groupSum(parsed: ParsedComponents, names: readonly string[]): number {
  let sum = 0;
  for (const name of names) sum += parsed[name] ?? 0;
  return sum;
}

/**
 * P-8: a group share is a unitless fraction in [0, 1] — already game-free
 * and scale-free, so no z-scoring. Returns `null` (leave the team's EWMA
 * unchanged) when the denominator is non-positive or any share is
 * non-finite.
 */
function sharesFor(parsed: ParsedComponents, groups: SeasonComponentGroups): Shares | null {
  const auto = groupSum(parsed, groups.auto);
  const teleop = groupSum(parsed, groups.teleop);
  const endgame = groupSum(parsed, groups.endgame);
  const denom = auto + teleop + endgame;
  if (!(denom > 0)) return null;
  const autoShare = auto / denom;
  const teleopShare = teleop / denom;
  const endgameShare = endgame / denom;
  if (!Number.isFinite(autoShare) || !Number.isFinite(teleopShare) || !Number.isFinite(endgameShare)) return null;
  return { autoShare, teleopShare, endgameShare };
}

function meanMarginZEwma(state: SeasonState, teamKeys: readonly string[]): number {
  if (teamKeys.length === 0) return 0;
  let sum = 0;
  for (const key of teamKeys) sum += readTeam(state, key).marginZEwma;
  return sum / teamKeys.length;
}

function applyTeamUpdate(
  t: TeamState,
  ownScoreZ: number,
  ownMarginZ: number,
  winIndicator: number,
  shares: Shares | null,
  oppStrengthValue: number,
  alpha: number,
  eventKey: string,
): void {
  if (t.currentEventKey !== eventKey) {
    t.currentEventKey = eventKey;
    t.matchesThisEvent = 0;
  }
  t.scoreZEwma = ewma(t.scoreZEwma, ownScoreZ, alpha);
  t.marginZEwma = ewma(t.marginZEwma, ownMarginZ, alpha);
  t.winEwma = ewma(t.winEwma, winIndicator, alpha);
  t.scoreZSum += ownScoreZ;
  t.marginZSum += ownMarginZ;
  t.winSum += winIndicator;
  if (shares !== null) {
    t.autoShareEwma = ewma(t.autoShareEwma, shares.autoShare, alpha);
    t.teleopShareEwma = ewma(t.teleopShareEwma, shares.teleopShare, alpha);
    t.endgameShareEwma = ewma(t.endgameShareEwma, shares.endgameShare, alpha);
  }
  // Skip the group-EWMA update entirely (P-8) when shares is null — the
  // team simply keeps its previous value (initialized to 0).
  t.oppStrengthEwma = ewma(t.oppStrengthEwma, oppStrengthValue, alpha);
  t.matchesThisEvent += 1;
  t.matchCount += 1;
  t.playedThisSeason = true;
}

/**
 * The only function in this file that reads `winner` / `redScore` /
 * `blueScore` / `scoreBreakdownRaw`. Order matters and is commented at each
 * step: fold both alliance scores into the Welford accumulator FIRST, then
 * compute the z-quantities used for the EWMA updates from the UPDATED
 * stats, then update per-team state.
 */
export function updateStates(state: SeasonState, match: GbrMatch, params: FeatureParams = DEFAULT_FEATURE_PARAMS): void {
  // 1. Fold both alliance scores into the season Welford accumulator first.
  foldWelford(state, match.redScore);
  foldWelford(state, match.blueScore);

  // 2. Z-quantities from the UPDATED stats — this match's own two scores are
  // already inside mean/M2 by this point, which is deliberate (see this
  // function's doc comment for why that asymmetry with extractFeatures is
  // correct).
  const sd = seasonSd(state);
  const mean = state.mean;
  const ownScoreZRed = (match.redScore - mean) / sd;
  const ownScoreZBlue = (match.blueScore - mean) / sd;
  const marginZRed = (match.redScore - match.blueScore) / sd;
  const marginZBlue = -marginZRed;
  const winRed = match.winner === "red" ? 1 : match.winner === "blue" ? 0 : 0.5;
  const winBlue = match.winner === "blue" ? 1 : match.winner === "red" ? 0 : 0.5;

  // Opponent strength — captured from the OPPOSING alliance's PRE-update
  // marginZEwma, before either alliance's own state is touched below (no
  // team appears on both alliances in one match, so this ordering is safe).
  const redOppStrength = meanMarginZEwma(state, match.blueTeams);
  const blueOppStrength = meanMarginZEwma(state, match.redTeams);

  // Group shares (P-1, P-8): parse both alliances from one JSON.parse via
  // tryParseBreakdownPair — never the bare, throwing parseBreakdown.
  const breakdownOutcome = tryParseBreakdownPair(match.year, match.scoreBreakdownRaw);
  let redShares: Shares | null = null;
  let blueShares: Shares | null = null;
  if (breakdownOutcome.kind === "absent") {
    state.absentBreakdownCount += 1;
  } else if (breakdownOutcome.kind === "malformed") {
    state.malformedBreakdownCount += 1;
  } else {
    const groups = componentGroupsForSeason(match.year);
    if (groups !== undefined) {
      redShares = sharesFor(breakdownOutcome.red, groups);
      blueShares = sharesFor(breakdownOutcome.blue, groups);
    }
  }

  const alpha = alphaFor(params.halflife);

  // 3. Update per-team state.
  for (const key of match.redTeams) {
    const t = getOrCreateTeam(state, key);
    applyTeamUpdate(t, ownScoreZRed, marginZRed, winRed, redShares, redOppStrength, alpha, match.eventKey);
  }
  for (const key of match.blueTeams) {
    const t = getOrCreateTeam(state, key);
    applyTeamUpdate(t, ownScoreZBlue, marginZBlue, winBlue, blueShares, blueOppStrength, alpha, match.eventKey);
  }
}

/**
 * P-2's Welford re-seed and P-9's boundary rule. For every known team, in
 * order: `prevSeasonRating` becomes `marginZEwma_final * prevSeasonDecay` if
 * the team played this season, otherwise `prevSeasonRating * prevSeasonDecay`
 * (a stale value decays again rather than freezing); `veteranSeasons`
 * increments only if the team played; then every per-season field resets.
 *
 * P-2: seeds the new season's Welford accumulator with a pseudo-count of 50
 * observations at the previous season's final (mean, sd) —
 * `count = 50, mean = prevMean, M2 = prevVar * 49`, reproducing `prevSd`
 * exactly. A season carried from zero observations (defensive — none of
 * GBR's nine design years hits this in practice) falls back to the same
 * `count = 0, mean = 0` cold start `initSeasonState` uses.
 */
export function carrySeason(
  state: SeasonState,
  nextSeason: number,
  params: FeatureParams = DEFAULT_FEATURE_PARAMS,
): SeasonState {
  const prevMean = state.mean;
  const prevSd = seasonSd(state);

  const newTeams = new Map<string, TeamState>();
  for (const [key, t] of state.teams) {
    const newPrevSeasonRating = t.playedThisSeason
      ? t.marginZEwma * params.prevSeasonDecay
      : t.prevSeasonRating * params.prevSeasonDecay;
    const newVeteranSeasons = t.playedThisSeason ? t.veteranSeasons + 1 : t.veteranSeasons;
    newTeams.set(key, {
      ...DEFAULT_TEAM,
      prevSeasonRating: newPrevSeasonRating,
      veteranSeasons: newVeteranSeasons,
    });
  }

  const hasObservations = state.count > 0;
  return {
    season: nextSeason,
    count: hasObservations ? 50 : 0,
    mean: hasObservations ? prevMean : 0,
    M2: hasObservations ? prevSd * prevSd * 49 : 0,
    teams: newTeams,
    // Cumulative package-lifetime counters (see SeasonState's doc comment) —
    // never reset by a season boundary.
    absentBreakdownCount: state.absentBreakdownCount,
    malformedBreakdownCount: state.malformedBreakdownCount,
  };
}
