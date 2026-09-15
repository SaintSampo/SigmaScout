/**
 * Published match-row assembly shared by the offline publisher (`publish.ts`),
 * the browser pricer (`eventStatePricing.ts`) and the live Worker
 * (`apps/worker/src/scheduled.ts`): rounding, key presence and comp-level
 * gates for one PLAYED event row, one upcoming event row and one team-season
 * row, played or upcoming.
 *
 * Moved verbatim out of `publish.ts`, so every caller builds rows through the
 * same code and they cannot disagree on a rounding call or a conditional key.
 * A live row and the offline row for the same match are then equal by
 * construction rather than by intention.
 *
 * BROWSER-SAFE: imports only `rounding.ts`, `constants.ts` and type-only
 * algorithm types. Never import `publish.ts` here, not even for a type, and
 * never `rules.ts` or a season RP file — a rule module arrives as a parameter
 * (`eventStatePricing.browserSafe.test.ts`).
 */
import type { CompLevel, MatchResult, Prediction, UpcomingMatch } from "../core/algorithms/types.js";
import { isBonusRpCompLevel, isRpEligibleEventType, type RpRuleModule } from "../core/rankingPoints/constants.js";
import { roundMetric, roundPmf, roundProbability, roundTo, ROUNDING_RULE } from "./rounding.js";

/**
 * Guards `TeamSeasonMatchSchema.actualRedRp`/`actualBlueRp`'s `.int()`: SQLite does not enforce
 * integer RP columns, and a stray non-integer (2024orbb/2025orbb's non-FRC `rp` field) would throw
 * inside `.parse()` and abort the whole publish. Degrades to `null` ("not derivable") instead of
 * rounding a fabricated RP. Exported so `scripts/measureRpCalibration.ts` shares this exact policy.
 */
export function toIntegerRpOrNull(value: number | null): number | null {
  return value !== null && Number.isInteger(value) ? value : null;
}

/** One match's actual per-bonus outcome, positionally aligned to the season's `RpRuleModule.bonusNames`. */
export interface ActualBonusFlags {
  readonly red: readonly boolean[];
  readonly blue: readonly boolean[];
}

/** The already-parsed per-side `bonusFlags` a caller may hand `actualBonusFlagsForMatch` instead of a re-parse; a side whose parse threw is `undefined`. */
export interface ParsedBonusSides {
  readonly red: Readonly<Record<string, boolean>> | undefined;
  readonly blue: Readonly<Record<string, boolean>> | undefined;
}

/** The match fields the actual-bonus rule reads. */
type BonusFlagMatch = Pick<MatchResult, "compLevel" | "eventType" | "hasScoreBreakdown" | "scoreBreakdownRaw">;

/**
 * ONE match's actual per-bonus outcome — the per-match body of `publish.ts`'s
 * `actualBonusFlagsForSeason`, moved here so the publisher and the live Worker share one rule.
 *
 * A non-qualification match gets `undefined` (absence), checked FIRST: bonus RP is not a property it
 * can have. `null` means a match that could have bonus RP but could not be derived: an RP-ineligible
 * event type, no score breakdown, or a breakdown that fails to parse (caught so one bad match cannot
 * abort a publish or a tick). The arrays map the rule module's own `bonusNames` in order, missing
 * names `false`, never spreading the parsed record, so extra keys in third-party JSON cannot change
 * their shape.
 *
 * `parsedSides` lets a caller that ALREADY parsed this breakdown (the Worker's Phase A RP fold) pass
 * the per-side `bonusFlags` straight through rather than paying a second parse against the tick's CPU
 * budget. It changes nothing about the answer: a side whose parse threw is `undefined` here and
 * yields the same `null` a re-parse would.
 */
export function actualBonusFlagsForMatch(
  match: BonusFlagMatch,
  ruleModule: RpRuleModule | undefined,
  parsedSides?: ParsedBonusSides
): ActualBonusFlags | null | undefined {
  if (ruleModule === undefined) return undefined;
  if (!isBonusRpCompLevel(match.compLevel)) return undefined;
  if (!isRpEligibleEventType(match.eventType) || !match.hasScoreBreakdown || match.scoreBreakdownRaw === null) return null;

  if (parsedSides !== undefined) {
    const { red, blue } = parsedSides;
    if (red === undefined || blue === undefined) return null;
    return bonusFlagArrays(ruleModule, red, blue);
  }

  try {
    const rawJson: unknown = JSON.parse(match.scoreBreakdownRaw);
    const redParsed = ruleModule.parse(rawJson, "red", match.eventType);
    const blueParsed = ruleModule.parse(rawJson, "blue", match.eventType);
    return bonusFlagArrays(ruleModule, redParsed.bonusFlags, blueParsed.bonusFlags);
  } catch {
    // One unparseable breakdown degrades to null rather than aborting the publish (or the tick).
    return null;
  }
}

function bonusFlagArrays(
  ruleModule: RpRuleModule,
  red: Readonly<Record<string, boolean>>,
  blue: Readonly<Record<string, boolean>>
): ActualBonusFlags {
  return {
    red: ruleModule.bonusNames.map((name) => red[name] ?? false),
    blue: ruleModule.bonusNames.map((name) => blue[name] ?? false),
  };
}

/** The schedule fields every row reads off a match; played and upcoming matches both carry them. */
type RowMatch = Pick<UpcomingMatch, "matchKey" | "eventKey" | "compLevel" | "setNumber" | "matchNumber" | "redTeams" | "blueTeams">;

/**
 * One match with its prediction and published display band. Structurally
 * `publish.ts`'s `UpcomingPredictionRecord` (and, for team rows, its
 * `PredictionRecord`), declared locally so this module never imports the CLI.
 */
export interface PublishedRowRecord {
  readonly match: RowMatch;
  readonly prediction: Prediction;
  readonly matchBand?: { red?: number; blue?: number };
}

/**
 * One row's published display band as a spreadable object, rounded once here; a side with no band
 * has no key. Played, upcoming and team-season rows all go through this, so they cannot disagree.
 */
export function matchBandFields(matchBand: { red?: number; blue?: number } | undefined): {
  redMatchBandVariance?: number;
  blueMatchBandVariance?: number;
} {
  return {
    ...(matchBand?.red !== undefined ? { redMatchBandVariance: roundTo(matchBand.red, ROUNDING_RULE.variance) } : {}),
    ...(matchBand?.blue !== undefined ? { blueMatchBandVariance: roundTo(matchBand.blue, ROUNDING_RULE.variance) } : {}),
  };
}

/**
 * The per-bonus RP fields for one event match row, with the same gates `buildTeamSeasonArtifact`
 * applies: predicted marginals only for a bonus-eligible level and a prediction carrying them; actual
 * flags only for a bonus-eligible level with a map entry, `null` staying `null` (never all-false).
 * An upcoming row passes `flags === undefined` and gets the predicted pair only.
 */
export function eventMatchBonusRpFields(
  compLevel: CompLevel,
  prediction: { readonly redBonusRp?: readonly number[]; readonly blueBonusRp?: readonly number[] },
  flags: { readonly red: readonly boolean[]; readonly blue: readonly boolean[] } | null | undefined
): Partial<{ redBonusRp: number[]; blueBonusRp: number[]; actualRedBonusRp: boolean[] | null; actualBlueBonusRp: boolean[] | null }> {
  return {
    ...(isBonusRpCompLevel(compLevel) && prediction.redBonusRp ? { redBonusRp: prediction.redBonusRp.map((p) => roundProbability(p)) } : {}),
    ...(isBonusRpCompLevel(compLevel) && prediction.blueBonusRp ? { blueBonusRp: prediction.blueBonusRp.map((p) => roundProbability(p)) } : {}),
    ...(isBonusRpCompLevel(compLevel) && flags !== undefined
      ? { actualRedBonusRp: flags === null ? null : [...flags.red], actualBlueBonusRp: flags === null ? null : [...flags.blue] }
      : {}),
  };
}

/**
 * A PLAYED match's record: `PublishedRowRecord` whose match carries the result too. `coldStart` is
 * present only when `true`, exactly as `replay.ts`'s `PredictionRecord` carries it — the Worker never
 * sets it (see `scheduled.ts`'s PLAYED ROWS note).
 */
export interface PublishedPlayedRowRecord extends PublishedRowRecord {
  readonly match: RowMatch & Pick<MatchResult, "winner" | "redScore" | "blueScore" | "redRpEarned" | "blueRpEarned">;
  readonly coldStart?: true;
}

/** The per-match lookups a played event row carries; each `undefined` leaves its key absent (`actualBonusFlags` distinguishes absent from an explicit `null`). */
export interface PlayedRowLookups {
  readonly sortTime: number | undefined;
  readonly video: string | undefined;
  readonly actualBonusFlags: ActualBonusFlags | null | undefined;
}

/** One `EventArtifact.matches` row, before schema parse. Moved verbatim out of `buildEventArtifact`. */
export function eventPlayedRow(record: PublishedPlayedRowRecord, lookups: PlayedRowLookups) {
  const { match, prediction, matchBand, coldStart } = record;
  return {
    matchKey: match.matchKey,
    compLevel: match.compLevel,
    setNumber: match.setNumber,
    matchNumber: match.matchNumber,
    sortTime: lookups.sortTime,
    redTeams: [...match.redTeams],
    blueTeams: [...match.blueTeams],
    predictedWinner: prediction.winner,
    pRedWin: roundProbability(prediction.pRedWin),
    predictedRedScore: roundMetric(prediction.redScore),
    predictedBlueScore: roundMetric(prediction.blueScore),
    // Each alliance's own predicted-score variance, the same quantity as
    // `TeamSeasonMatchSchema.redScoreVarianceOwn`; `undefined` for OPR/EPA. Read off `predict()`'s
    // output, never recomputed, so it cannot silently stop reflecting the model.
    redScoreVarianceOwn:
      prediction.redScoreVarianceOwn !== undefined ? roundTo(prediction.redScoreVarianceOwn, ROUNDING_RULE.variance) : undefined,
    blueScoreVarianceOwn:
      prediction.blueScoreVarianceOwn !== undefined ? roundTo(prediction.blueScoreVarianceOwn, ROUNDING_RULE.variance) : undefined,
    // Match Band: roster size times the sum of the roster's squared Sigma Scores, walk-forward. Sigma
    // algorithms only; never the win-odds variance the ranking-point pmf reads.
    ...matchBandFields(matchBand),
    // Total-RP pmfs, read off `prediction` and deliberately not gated on competition level, matching
    // the upcoming and team-season builders; absent where the model produced none.
    redRpPmf: prediction.redRpPmf ? roundPmf(prediction.redRpPmf) : undefined,
    blueRpPmf: prediction.blueRpPmf ? roundPmf(prediction.blueRpPmf) : undefined,
    // The RP decomposition, ungated for the same reason.
    matchOutcomePmf: prediction.matchOutcomePmf ? roundPmf(prediction.matchOutcomePmf) : undefined,
    redBonusRpPmf: prediction.redBonusRpPmf ? roundPmf(prediction.redBonusRpPmf) : undefined,
    blueBonusRpPmf: prediction.blueBonusRpPmf ? roundPmf(prediction.blueBonusRpPmf) : undefined,
    ...eventMatchBonusRpFields(match.compLevel, prediction, lookups.actualBonusFlags),
    actualWinner: match.winner,
    actualRedScore: match.redScore,
    actualBlueScore: match.blueScore,
    // The key never appears as `false`.
    ...(coldStart === true ? { coldStart: true as const } : {}),
    // Always present on played rows (direct assignment), and `null` never becomes `0`: a `0` is a
    // positive claim about standing that a fallback then sums.
    actualRedRp: toIntegerRpOrNull(match.redRpEarned),
    actualBlueRp: toIntegerRpOrNull(match.blueRpEarned),
    ...(lookups.video !== undefined ? { video: lookups.video } : {}),
  };
}

/**
 * One PLAYED `TeamSeasonArtifact` match row: `teamSeasonMatchRow` plus the played-only keys. Moved
 * verbatim out of `buildTeamSeasonArtifact`'s played branch.
 */
export function teamSeasonPlayedRow(
  record: PublishedPlayedRowRecord,
  stamps: TeamSeasonRowStamps,
  actualBonusFlags: ActualBonusFlags | null | undefined
) {
  const { match, coldStart } = record;
  return {
    ...teamSeasonMatchRow(record, stamps),
    actualWinner: match.winner,
    actualRedScore: match.redScore,
    actualBlueScore: match.blueScore,
    ...(coldStart === true ? { coldStart: true as const } : {}),
    // Never coerced null -> 0.
    actualRedRp: toIntegerRpOrNull(match.redRpEarned),
    actualBlueRp: toIntegerRpOrNull(match.blueRpEarned),
    // Missing entry: keys absent. Present `null`: explicit null. Arrays are copied, never aliased,
    // and gated on comp level against a caller map with a playoff entry.
    ...(isBonusRpCompLevel(match.compLevel) && actualBonusFlags !== undefined
      ? { actualRedBonusRp: actualBonusFlags === null ? null : [...actualBonusFlags.red], actualBlueBonusRp: actualBonusFlags === null ? null : [...actualBonusFlags.blue] }
      : {}),
  };
}

/** One `EventArtifact.upcoming` row, before schema parse. `sortTime` is the caller's lookup; `undefined` stays absent after parse. */
export function eventUpcomingRow(record: PublishedRowRecord, sortTime: number | undefined) {
  const { match, prediction, matchBand } = record;
  return {
    matchKey: match.matchKey,
    compLevel: match.compLevel,
    setNumber: match.setNumber,
    matchNumber: match.matchNumber,
    sortTime,
    redTeams: [...match.redTeams],
    blueTeams: [...match.blueTeams],
    predictedWinner: prediction.winner,
    pRedWin: roundProbability(prediction.pRedWin),
    predictedRedScore: roundMetric(prediction.redScore),
    predictedBlueScore: roundMetric(prediction.blueScore),
    redScoreVarianceOwn:
      prediction.redScoreVarianceOwn !== undefined ? roundTo(prediction.redScoreVarianceOwn, ROUNDING_RULE.variance) : undefined,
    blueScoreVarianceOwn:
      prediction.blueScoreVarianceOwn !== undefined ? roundTo(prediction.blueScoreVarianceOwn, ROUNDING_RULE.variance) : undefined,
    ...matchBandFields(matchBand),
    redRpPmf: prediction.redRpPmf ? roundPmf(prediction.redRpPmf) : undefined,
    blueRpPmf: prediction.blueRpPmf ? roundPmf(prediction.blueRpPmf) : undefined,
    matchOutcomePmf: prediction.matchOutcomePmf ? roundPmf(prediction.matchOutcomePmf) : undefined,
    redBonusRpPmf: prediction.redBonusRpPmf ? roundPmf(prediction.redBonusRpPmf) : undefined,
    blueBonusRpPmf: prediction.blueBonusRpPmf ? roundPmf(prediction.blueBonusRpPmf) : undefined,
    // No actual outcome yet, so predicted marginals only.
    ...eventMatchBonusRpFields(match.compLevel, prediction, undefined),
  };
}

/** The per-artifact stamps and per-match lookups a team-season row carries. */
export interface TeamSeasonRowStamps {
  readonly season: number;
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  /** `match_key` -> `sort_time` lookup result; `undefined` leaves the key absent after parse. */
  readonly sortTime: number | undefined;
  /** The raw YouTube video key lookup result; the key is spread only when defined. */
  readonly video: string | undefined;
}

/**
 * The fields every `TeamSeasonArtifact` match row carries, played or upcoming. The played branch in
 * `buildTeamSeasonArtifact` spreads this and appends its played-only keys.
 */
export function teamSeasonMatchRow(record: PublishedRowRecord, stamps: TeamSeasonRowStamps) {
  const { match, prediction } = record;
  const sortTime = stamps.sortTime;
  return {
    matchKey: match.matchKey,
    season: stamps.season,
    eventKey: match.eventKey,
    compLevel: match.compLevel,
    algorithmId: stamps.algorithmId,
    algorithmVersion: stamps.algorithmVersion,
    predictedWinner: prediction.winner,
    pRedWin: roundProbability(prediction.pRedWin),
    predictedRedScore: roundMetric(prediction.redScore),
    predictedBlueScore: roundMetric(prediction.blueScore),
    variance: prediction.variance !== undefined ? roundTo(prediction.variance, ROUNDING_RULE.variance) : undefined,
    // Each alliance's own predicted-score variance; undefined for OPR/EPA.
    redScoreVarianceOwn:
      prediction.redScoreVarianceOwn !== undefined ? roundTo(prediction.redScoreVarianceOwn, ROUNDING_RULE.variance) : undefined,
    blueScoreVarianceOwn:
      prediction.blueScoreVarianceOwn !== undefined ? roundTo(prediction.blueScoreVarianceOwn, ROUNDING_RULE.variance) : undefined,
    // The same `record.matchBand` the event artifact reads, so both rows match by construction.
    ...matchBandFields(record.matchBand),
    redRpPmf: prediction.redRpPmf ? roundPmf(prediction.redRpPmf) : undefined,
    blueRpPmf: prediction.blueRpPmf ? roundPmf(prediction.blueRpPmf) : undefined,
    // The Match column's label, published rather than re-derived client-side from the matchKey.
    setNumber: match.setNumber,
    matchNumber: match.matchNumber,
    sortTime,
    redTeams: [...match.redTeams],
    blueTeams: [...match.blueTeams],
    // Predicted per-bonus marginals are independent probabilities, so they round per value, never
    // through `roundPmf`. Gated on the comp level so a playoff row carries neither key even if a
    // caller-supplied `Prediction` has them.
    ...(isBonusRpCompLevel(match.compLevel) && prediction.redBonusRp
      ? { redBonusRp: prediction.redBonusRp.map((p) => roundProbability(p)) }
      : {}),
    ...(isBonusRpCompLevel(match.compLevel) && prediction.blueBonusRp
      ? { blueBonusRp: prediction.blueBonusRp.map((p) => roundProbability(p)) }
      : {}),
    // Unconditional lookup; the corpus has no `video_key` for unplayed matches.
    ...(stamps.video !== undefined ? { video: stamps.video } : {}),
  };
}
