/**
 * The RP scorecard's pure card model (F1, D-09, D-11) — modelled on
 * `calibrationCards.ts`'s per-algorithm plain-language card shape, reusing
 * its `SPARSE_N`/`fmtPct`/`niceCeil` rather than redeclaring any of them.
 * Display form settled by
 * `.claude/skills/sketch-findings-sigmascout/references/simulation-and-compare.md`
 * (sentence-first, chart demoted, sample count mandatory, sparse bins
 * flagged) — this module produces the data that display reads, never a
 * second reading of it.
 *
 * Input type is derived from the exported `CompareRpCalibration` wire type
 * (`packages/harness/pageArtifacts.ts`) — no second hand-typed interface.
 */
import { fmtPct, SPARSE_N } from "./calibrationCards.js";
import type { CompareRpCalibration } from "../../../../../packages/harness/pageArtifacts.js";

export interface RpCalibrationCardBonusRow {
  readonly name: string;
  readonly count: number;
  readonly meanPredicted: number;
  readonly observedFrequency: number;
  readonly brierScore: number;
  /** `count < SPARSE_N` — the shared absolute floor `calibrationCards.ts` declares. */
  readonly sparse: boolean;
}

/**
 * The card's whole-ranking-points model (2026-09-13, quick task 260913-qyn) —
 * `CompareRpTotalSchema`'s figures, unchanged (no re-derivation, matching
 * this module's existing bonus-row convention). `null` when the record
 * carries no `totalRp` block (this artifact predates the scorer, or this
 * season/algorithm's block had zero observations) — never a zero-filled row.
 */
export interface RpCalibrationTotalModel {
  readonly count: number;
  readonly rankedProbabilityScore: number;
  readonly meanPredictedRp: number;
  readonly meanActualRp: number;
}

/**
 * The card's win/tie/loss outcome model (2026-09-13, quick task 260913-qyn) —
 * `CompareRpOutcomeSchema`'s figures, unchanged. `null` when the record
 * carries no `outcome` block.
 */
export interface RpCalibrationOutcomeModel {
  readonly count: number;
  readonly brierScore: number;
  readonly meanPredictedTie: number;
  readonly observedTieRate: number;
}

export interface RpCalibrationCardModel {
  /** One row per bonus the record carries, in the record's OWN array order (the season module's `bonusNames` order) — never re-sorted, never alphabetised. */
  readonly bonuses: readonly RpCalibrationCardBonusRow[];
  /**
   * The bonus with the largest absolute gap between `observedFrequency` and
   * `meanPredicted`. Ties break on the larger `count`, then on the earlier
   * array index — a deterministic scan, never `Array.sort` on equal keys
   * alone. `null` when the record is `undefined` (this artifact predates
   * the field) or carries zero scored bonuses.
   */
  readonly headline: RpCalibrationCardBonusRow | null;
  /** This card's own max |observed − predicted| across its bonuses (0 when there are none). */
  readonly maxAbsDeviation: number;
  /** 2026-09-13 (260913-qyn): the total-RP block, or `null` when absent. */
  readonly totalRp: RpCalibrationTotalModel | null;
  /** 2026-09-13 (260913-qyn): the win/tie/loss outcome block, or `null` when absent. */
  readonly outcome: RpCalibrationOutcomeModel | null;
}

/**
 * Builds one algorithm's RP card model from its slice's `rpCalibration`
 * record. `record === undefined` — the artifact predates the field, or this
 * season/algorithm has no measurement — produces an empty model: `bonuses`
 * is `[]` and `headline` is `null`, NEVER a zero-filled row and never a
 * thrown error.
 */
export function buildRpCalibrationCard(record: CompareRpCalibration | undefined): RpCalibrationCardModel {
  if (record === undefined) {
    return { bonuses: [], headline: null, maxAbsDeviation: 0, totalRp: null, outcome: null };
  }

  const bonuses: RpCalibrationCardBonusRow[] = record.bonuses.map((b) => ({
    name: b.name,
    count: b.count,
    meanPredicted: b.meanPredicted,
    observedFrequency: b.observedFrequency,
    brierScore: b.brierScore,
    sparse: b.count < SPARSE_N,
  }));

  let headline: RpCalibrationCardBonusRow | null = null;
  let headlineGap = -1;
  let headlineCount = -1;
  for (const row of bonuses) {
    const gap = Math.abs(row.observedFrequency - row.meanPredicted);
    const strictlyBetter = gap > headlineGap;
    const tiedButLargerSample = gap === headlineGap && row.count > headlineCount;
    if (headline === null || strictlyBetter || tiedButLargerSample) {
      headline = row;
      headlineGap = gap;
      headlineCount = row.count;
    }
  }

  const maxAbsDeviation = bonuses.reduce((m, b) => Math.max(m, Math.abs(b.observedFrequency - b.meanPredicted)), 0);

  const totalRp: RpCalibrationTotalModel | null =
    record.totalRp === undefined
      ? null
      : {
          count: record.totalRp.count,
          rankedProbabilityScore: record.totalRp.rankedProbabilityScore,
          meanPredictedRp: record.totalRp.meanPredictedRp,
          meanActualRp: record.totalRp.meanActualRp,
        };

  const outcome: RpCalibrationOutcomeModel | null =
    record.outcome === undefined
      ? null
      : {
          count: record.outcome.count,
          brierScore: record.outcome.brierScore,
          meanPredictedTie: record.outcome.meanPredictedTie,
          observedTieRate: record.outcome.observedTieRate,
        };

  return { bonuses, headline, maxAbsDeviation, totalRp, outcome };
}

/** Prints the sample count, always, and is built entirely from the row's own numbers — no argument may be a hand-typed figure. */
export function rpCardHeadlineSentence(algorithmLabel: string, headline: RpCalibrationCardBonusRow): string {
  return `${algorithmLabel} predicted the ${headline.name} bonus at about ${fmtPct(headline.meanPredicted)}%, and it actually happened ${fmtPct(headline.observedFrequency)}% of the time, across ${headline.count.toLocaleString("en-US")} matches.`;
}

/**
 * The total-RP plain-language sentence (2026-09-13, quick task 260913-qyn) —
 * built entirely from `total`'s own numbers, prints the sample count always.
 * One decimal place: ranking points are a small, continuous quantity (a
 * season mean sits near 2-3), where a whole-number round would erase the
 * exact difference the sentence exists to show.
 */
export function rpTotalSentence(algorithmLabel: string, total: RpCalibrationTotalModel): string {
  return `${algorithmLabel} expected about ${total.meanPredictedRp.toFixed(1)} ranking points per alliance per match, and alliances actually earned ${total.meanActualRp.toFixed(1)}, across ${total.count.toLocaleString("en-US")} alliance results.`;
}

/**
 * The tie plain-language sentence (2026-09-13, quick task 260913-qyn) — built
 * entirely from `outcome`'s own numbers, prints the sample count always.
 * One decimal place on the percentages: a tie is a genuinely rare outcome
 * (typically well under 1%), and `fmtPct`'s default 0 decimals would round
 * BOTH the predicted chance and the observed rate to "0%" — which would
 * read as "tie has zero probability," exactly the false claim this sentence
 * exists to correct (see `docs/models/rp-layer-config-arms.md`).
 */
export function rpTieSentence(algorithmLabel: string, outcome: RpCalibrationOutcomeModel): string {
  return `${algorithmLabel} gave a tie about ${fmtPct(outcome.meanPredictedTie, 1)}% chance on average, and ${fmtPct(outcome.observedTieRate, 1)}% of these ${outcome.count.toLocaleString("en-US")} matches actually tied.`;
}
