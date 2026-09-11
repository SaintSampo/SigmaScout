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
    return { bonuses: [], headline: null, maxAbsDeviation: 0 };
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

  return { bonuses, headline, maxAbsDeviation };
}

/** Prints the sample count, always, and is built entirely from the row's own numbers — no argument may be a hand-typed figure. */
export function rpCardHeadlineSentence(algorithmLabel: string, headline: RpCalibrationCardBonusRow): string {
  return `${algorithmLabel} predicted the ${headline.name} bonus at about ${fmtPct(headline.meanPredicted)}%, and it actually happened ${fmtPct(headline.observedFrequency)}% of the time, across ${headline.count.toLocaleString("en-US")} matches.`;
}
