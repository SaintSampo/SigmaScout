/**
 * Measures the SigmaScout RP layer's published bonus probabilities against
 * what actually happened.
 *
 * `packages/core/rankingPoints/empiricalMoments.ts` documents three deliberate
 * simplifications — a DIAGONAL covariance block, a ZERO score cross-covariance,
 * and variance about each team's own mean — and states their expected
 * consequence in advance:
 *
 *   > All three make the predicted distribution NARROWER and less correlated
 *   > than reality. The published effect is bonus probabilities pulled toward
 *   > the extremes.
 *
 * That is a falsifiable claim with a stated direction, and this script is what
 * checks it rather than leaving it as an assertion in a header. It reports
 * three things per season:
 *
 *   1. RELIABILITY per bonus — mean predicted probability against observed
 *      frequency, plus a Brier score and a bucketed reliability table. This is
 *      the ordinary "is it calibrated" question.
 *
 *   2. THE EXTREMES CLAIM — what fraction of predictions land below 0.05 or
 *      above 0.95, and what actually happened in those buckets. If the
 *      distribution really is too narrow, confident predictions should be
 *      WRONG more often than their confidence implies.
 *
 *   3. THE CORRELATION CLAIM, which is the one the diagonal block is actually
 *      about. The model draws thresholds independently, so its implied joint is
 *      the product of its marginals. Reality need not be: an alliance good at
 *      one threshold is probably good at the other. Comparing observed
 *      P(A and B) against observed P(A)*P(B) measures the real dependence the
 *      model is throwing away, and its sign says which way the simplification
 *      errs.
 *
 * Walk-forward throughout, driven through the SAME `SigmaScoutLayer` the
 * publisher runs, so these are the published numbers and not a re-derivation
 * that could disagree with them.
 *
 * ---------------------------------------------------------------------------
 * SAME-SCORER FIX (2026-09-11, phase 09 plan 09-01 Task 1 Step 1, D-11)
 * ---------------------------------------------------------------------------
 *
 * This script used to construct its `SigmaScoutLayer` with ONE constructor
 * argument (the rule module only), while the publisher
 * (`packages/harness/publish.ts`) always constructs it with TWO (the rule
 * module AND the algorithm id). The second argument is the ONLY thing that
 * selects `SigmaScoreAccumulator` over
 * `SwingFactorAccumulator` (`sigmaScoutLayer.ts`'s `usesSigmaScore` check —
 * `SIGMA_SCORE_ALGORITHM_IDS` is `{bpr}`, this script's own default
 * `--algorithm`), so every bpr bonus probability this script reported BEFORE
 * this fix was computed from Swing-derived band variance while every
 * published bpr row is computed from Sigma-derived band variance — the exact
 * defect class recorded in STATE row 110 (two publish paths fed Swing and
 * Sigma to the ranking-point filler and produced 0.46525 against 0.47 for the
 * same event). Fixed by passing the resolved algorithm id as the layer's
 * second constructor argument, so this script is now provably the same scorer
 * the publisher runs, for every algorithm — the whole premise of D-11's
 * same-scorer mitigation.
 *
 * `.planning/todos/pending/ranking-points-audit.md` F2's recorded 0.1507 /
 * 0.3109 predates this fix and is NOT the number 09-01-SUMMARY.md freezes —
 * see that summary's before/after table for the corrected figures.
 *
 * ---------------------------------------------------------------------------
 * THE ARM VOCABULARY (2026-09-11, phase 09 plan 09-06 Task 1, D-09/D-11)
 * ---------------------------------------------------------------------------
 *
 * This script now measures up to EIGHT named arms — the full cross product of
 * the three `RpLayerConfig` fields 09-05 landed — and EVERY ARM PASSES THROUGH
 * THE SAME IMPORTED `SigmaScoutLayer`, in one process, at one commit, over ONE
 * walk-forward replay per season. There is exactly one layer construction site
 * in this file and exactly one `runAll` per season; the arms multiply layers,
 * never replays. That sentence is D-11's mitigation expressed as a file-header
 * discipline, and it is the same convention `measureRewindGap.ts` carries for
 * its two arms.
 *
 *   control           all-legacy — THE HONEST BASELINE
 *   win               winSource: "p-red-win"            (D-13)
 *   tie               tieModel:  "discrete-margin"      (D-14)
 *   marginal          marginal:  "negative-binomial"    (D-01)
 *   win+tie, win+marginal, tie+marginal, win+tie+marginal
 *
 * `control` IS THE LEFT-HAND SIDE OF D-09's BAR. It is the all-legacy config
 * running on 09-04's CLOSED FORM, measured at HEAD in the same process as
 * every other arm. D-10 ships the closed form unconditionally, so the engine
 * swap is not on trial; the only question the bar governs is whether each
 * MODELLING change earns its place GIVEN the closed form.
 *
 * CROSS-GENERATION WARNING. 09-01's frozen
 * `data/baselines/rp-calibration-2026-09.json` was captured BEFORE 09-04
 * replaced the 4,000-draw Monte Carlo with the closed form, and every
 * published pmf value changed as a result. A comparison against that file is
 * therefore a CROSS-GENERATION comparison — it measures the engine swap, not a
 * modelling change — and MUST be labelled as one wherever it is reported. It
 * is never the left-hand side of D-09's bar: scoring an arm against it would
 * credit or blame the modelling changes for the Monte Carlo's removal, and
 * would compare a HEAD-computed number against one produced by code that no
 * longer exists.
 *
 * Usage:
 *   npx tsx scripts/measureRpCalibration.ts [--seasons 2024-2026] [--algorithm bpr] [--arms all] [--emit-artifact <path>]
 *
 * `--arms` DEFAULTS TO `control` ALONE, so every pre-existing invocation —
 * including `ranking-points-audit.md`'s own reproduction command — keeps
 * exactly its current meaning.
 */

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { openCorpusReadOnly } from "../packages/corpus/db.js";
import { buildSeasonStream, WalkForwardSimulator } from "../packages/harness/replay.js";
import { SigmaScoutLayer } from "../packages/harness/sigmaScoutLayer.js";
import { RP_RULE_MODULES } from "../packages/core/rankingPoints/rules.js";
import { actualBonusFlagsForSeason } from "../packages/harness/publish.js";
import { resolvePublishAlgorithms } from "../packages/harness/publish.js";
import { RpCalibrationMeasurementSchema, type RpCalibrationRecord } from "../packages/harness/publish.js";
import {
  emptyMarginalResolutionTally,
  RP_LAYER_CONFIG_DEFAULT,
  type MarginalResolutionTally,
  type RpLayerConfig,
} from "../packages/core/rankingPoints/analyticPmf.js";

const CORPUS_PATH = "data/corpus.sqlite";

/** One (match, alliance, bonus) prediction paired with what happened. */
export interface Observation {
  readonly predicted: number;
  readonly actual: boolean;
}

function parseSeasons(spec: string): number[] {
  const seasons: number[] = [];
  for (const part of spec.split(",")) {
    const range = part.split("-").map((n) => Number.parseInt(n.trim(), 10));
    if (range.length === 2 && Number.isFinite(range[0]!) && Number.isFinite(range[1]!)) {
      for (let s = range[0]!; s <= range[1]!; s++) seasons.push(s);
    } else if (Number.isFinite(range[0]!)) {
      seasons.push(range[0]!);
    }
  }
  return seasons;
}

function brier(observations: readonly Observation[]): number {
  if (observations.length === 0) return Number.NaN;
  let sum = 0;
  for (const o of observations) {
    const diff = o.predicted - (o.actual ? 1 : 0);
    sum += diff * diff;
  }
  return sum / observations.length;
}

function rate(observations: readonly Observation[]): number {
  if (observations.length === 0) return Number.NaN;
  return observations.filter((o) => o.actual).length / observations.length;
}

function meanPredicted(observations: readonly Observation[]): number {
  if (observations.length === 0) return Number.NaN;
  return observations.reduce((sum, o) => sum + o.predicted, 0) / observations.length;
}

/**
 * Exported (promoted from the module-local `BUCKET_EDGES`) so the artifact
 * emitter (`buildRpCalibrationRecord` below) and any future consumer share
 * ONE bucket definition rather than a second hand-copied literal. The final
 * edge is `1.0000001`, not `1`, so a prediction of exactly `1.0` lands in the
 * last bucket instead of falling off the end — unchanged from the original
 * `BUCKET_EDGES`.
 */
export const RP_RELIABILITY_BUCKET_EDGES = [0, 0.05, 0.2, 0.4, 0.6, 0.8, 0.95, 1.0000001];

function reliabilityTable(observations: readonly Observation[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < RP_RELIABILITY_BUCKET_EDGES.length - 1; i++) {
    const lo = RP_RELIABILITY_BUCKET_EDGES[i]!;
    const hi = RP_RELIABILITY_BUCKET_EDGES[i + 1]!;
    const inBucket = observations.filter((o) => o.predicted >= lo && o.predicted < hi);
    if (inBucket.length === 0) continue;
    const predicted = meanPredicted(inBucket);
    const observed = rate(inBucket);
    const gap = observed - predicted;
    const flag = Math.abs(gap) > 0.05 ? (gap > 0 ? "  <- under-predicts" : "  <- over-predicts") : "";
    lines.push(
      `      [${lo.toFixed(2)},${hi >= 1 ? "1.00" : hi.toFixed(2)})  n=${String(inBucket.length).padStart(6)}  ` +
        `predicted=${predicted.toFixed(4)}  observed=${observed.toFixed(4)}  gap=${gap >= 0 ? "+" : ""}${gap.toFixed(4)}${flag}`
    );
  }
  return lines;
}

/**
 * Pure: builds one (season, algorithm) publishable calibration record from
 * this season's bonus names and the per-bonus observations folded during the
 * walk-forward loop. Built from the SAME `brier`/`rate`/`meanPredicted`
 * helpers the console report above already uses — never a parallel
 * computation (D-11's "one scorer" requirement extends to this emitter, not
 * just to the console path).
 *
 * A bonus with zero observations is OMITTED from `bonuses` rather than
 * emitted with `NaN` figures (T-09-04) — the same "absence, not a coerced
 * zero" discipline the wire schema documents. `reliabilityBins` pools EVERY
 * bonus's observations for this (season, algorithm) into one set of buckets,
 * mirroring the console report's own pooled-per-season framing; an empty
 * bucket gets `null` figures and `count: 0`, never a divide-by-zero NaN.
 */
export function buildRpCalibrationRecord(
  bonusNames: readonly string[],
  perBonusObservations: readonly (readonly Observation[])[]
): RpCalibrationRecord {
  const bonuses: RpCalibrationRecord["bonuses"][number][] = [];
  const pooled: Observation[] = [];

  for (let i = 0; i < bonusNames.length; i++) {
    const observations = perBonusObservations[i] ?? [];
    pooled.push(...observations);
    if (observations.length === 0) continue;
    bonuses.push({
      name: bonusNames[i]!,
      count: observations.length,
      meanPredicted: meanPredicted(observations),
      observedFrequency: rate(observations),
      brierScore: brier(observations),
    });
  }

  // Task 2 Step 5 (2026-09-11): the wire record used to also carry a
  // `reliabilityBins` array here, pooled the same way `reliabilityTable`
  // below buckets for the console. Real measured bytes showed attaching it
  // to every 2016 qualification slice (three algorithms' worth) pushed
  // `compare-2016.json` to 21,260 bytes against the committed 20,000-byte
  // `budgetMaxBytes` — dropped per this plan's pre-committed remedy (shrink
  // the block, never raise the budget), since nothing on the Compare page
  // ever read it. `RP_RELIABILITY_BUCKET_EDGES` remains exported and used
  // by `reliabilityTable` below for the console report, which is unaffected.
  return { scoredCount: pooled.length, bonuses };
}

// ---------------------------------------------------------------------------
// D-09's BAR, FROZEN (phase 09 plan 09-06 Task 1 Step 1)
// ---------------------------------------------------------------------------
//
// Everything in this section is committed BEFORE any 2023-2026 figure exists.
// It is the rule that decides whether each of phase 09's three RP model
// changes ships, and it may not be adjusted, relaxed, re-scoped or re-derived
// after a reporting-slice number has been seen.
//
// D-09, verbatim: an arm ships when a MAJORITY of the individual bonus cells
// on the reporting slice improve on Brier AND NO SINGLE CELL gets worse.
//
// TIES SIT IN THE DENOMINATOR AND HELP NEITHER SIDE. A tied cell stays in
// `scored` and counts toward neither `improved` nor `regressed`, so every tie
// makes the majority harder to reach. That is the conservative direction and
// it was chosen deliberately: a change that moves nothing should not be able
// to buy itself a majority out of cells it did not affect.
//
// WHY D-11's ABSENCE OF AN EFFECT-SIZE FLOOR IS HONEST HERE. D-11 declined the
// paired-bootstrap interval and said any improvement in the right direction
// counts. That would normally be sloppy. It is defensible in THIS measurement
// because 09-04 deleted the 4,000-draw Monte Carlo: both arms are now exact
// deterministic computations over the identical observation set, differing
// only in the config field under test. The +/-0.008 of sampling scatter that
// would have demanded an effect-size floor is precisely what the phase
// removed, so a difference of any magnitude is a real difference rather than
// a draw of the dice. If the Monte Carlo ever returns, this reasoning — and
// therefore this bar — stops holding.
//
// D-04 MAKES THE MEASUREMENT ONE-WAY. The 2023-2026 slice is the only clean
// out-of-sample evidence this phase has, and the 2026 holdout was already
// spent once on this project. The whole reason this section exists in its own
// commit, ahead of every line of measurement code, is so the reporting slice
// can only ever produce the verdict this rule already defined — never a
// verdict chosen to fit the numbers. That failure would leave the suite green.

/**
 * The three RP model changes under test, named by the config field each one
 * flips. These names are also the single-change arm names in
 * `RP_ATTRIBUTION_ARMS`, so a verdict map is keyed by them directly.
 */
export const RP_ARM_FIELDS = ["win", "tie", "marginal"] as const;
export type RpArmField = (typeof RP_ARM_FIELDS)[number];

/**
 * What each field's SHIP branch sets. Typed as `Partial<RpLayerConfig>` on
 * purpose: a member renamed or removed upstream becomes a compile error here
 * rather than a silently wrong arm.
 */
export const RP_ARM_FIELD_SHIP_VALUES: { readonly [K in RpArmField]: Partial<RpLayerConfig> } = {
  win: { winSource: "p-red-win" },
  tie: { tieModel: "discrete-margin" },
  marginal: { marginal: "negative-binomial" },
};

/**
 * The FIXED tie-break order for step 2's single permitted drop. When two
 * fields have the same number of improved cells, the one earliest in this list
 * is dropped. Pinned here rather than derived so the rule is deterministic and
 * cannot be re-ordered later to change an outcome.
 */
export const RP_ARM_DROP_ORDER: readonly RpArmField[] = ["marginal", "tie", "win"];

/** One scored bonus cell: one `(algorithmId, season, bonusName)` triple's figures under one arm. */
export interface RpBonusCell {
  readonly algorithmId: string;
  readonly season: number;
  readonly bonusName: string;
  readonly count: number;
  readonly meanPredicted: number;
  readonly observedFrequency: number;
  readonly brierScore: number;
}

/** One arm's standing against `control` under D-09's bar. */
export interface RpArmVerdict {
  readonly arm: string;
  readonly scored: number;
  readonly improved: number;
  readonly regressed: number;
  readonly tied: number;
  readonly meetsBar: boolean;
}

/** The pre-committed three-step rule's output. `path` is the human-readable trace of how it got there. */
export interface RpShipDecision {
  readonly shipConfig: RpLayerConfig;
  readonly acceptedFields: readonly string[];
  readonly revertedFields: readonly string[];
  readonly path: readonly string[];
}

/** The stable key a cell is matched by across arms — never the array index. */
function cellKey(cell: RpBonusCell): string {
  return `${cell.algorithmId}|${cell.season}|${cell.bonusName}`;
}

/**
 * D-09's bar as code.
 *
 * UNIT OF ACCOUNT: one scored cell is one `(algorithmId, season, bonusName)`
 * triple with at least one observation in BOTH arms. A cell with `count` 0 in
 * either arm is excluded from `scored` entirely — a cell needs an observation
 * on both sides to be comparable at all, and emitting a Brier over zero
 * observations would put a NaN into a committed measurement.
 *
 * PER-CELL OUTCOME: improves when `brier_arm < brier_control` strictly,
 * regresses when `brier_arm > brier_control` strictly, ties when the two
 * compare equal under `===`.
 *
 * THE BAR: `improved > scored / 2` AND `regressed === 0`.
 *
 * Cells are matched by key, never by position, so two arrays in different
 * orders give the same verdict. A key present in one arm and absent from the
 * other THROWS rather than being dropped: silently dropping it would let a
 * mis-wired arm report a smaller, easier table and still claim a majority.
 *
 * Pure and total — it reads no clock, no filesystem, no corpus and no
 * `process.argv`, and it mutates neither input.
 *
 * `armName` only labels the returned verdict; it never affects the arithmetic.
 */
export function evaluateD09Bar(
  control: readonly RpBonusCell[],
  arm: readonly RpBonusCell[],
  armName = "arm"
): RpArmVerdict {
  const controlByKey = new Map(control.map((c) => [cellKey(c), c]));
  const armByKey = new Map(arm.map((c) => [cellKey(c), c]));

  for (const key of controlByKey.keys()) {
    if (!armByKey.has(key)) {
      throw new Error(`evaluateD09Bar: cell "${key}" is present in control but absent from arm "${armName}" — a missing cell is a wiring fault, not a smaller table`);
    }
  }
  for (const key of armByKey.keys()) {
    if (!controlByKey.has(key)) {
      throw new Error(`evaluateD09Bar: cell "${key}" is present in arm "${armName}" but absent from control — a missing cell is a wiring fault, not a smaller table`);
    }
  }

  let scored = 0;
  let improved = 0;
  let regressed = 0;
  let tied = 0;

  // Sorted so the traversal order — and therefore the function — is
  // independent of either input array's order.
  for (const key of [...controlByKey.keys()].sort()) {
    const c = controlByKey.get(key)!;
    const a = armByKey.get(key)!;
    if (c.count === 0 || a.count === 0) continue;
    scored++;
    if (a.brierScore < c.brierScore) improved++;
    else if (a.brierScore > c.brierScore) regressed++;
    else tied++;
  }

  return {
    arm: armName,
    scored,
    improved,
    regressed,
    tied,
    meetsBar: improved > scored / 2 && regressed === 0,
  };
}

/**
 * The arm name for a set of shipped fields, in `RP_ARM_FIELDS` order joined by
 * `+`, or `"control"` for the empty set. This is the single source of the arm
 * vocabulary: the registry builds its names from it and the rule looks its
 * verdicts up by it, so the two cannot drift.
 */
export function rpArmNameForFields(fields: readonly RpArmField[]): string {
  const present = RP_ARM_FIELDS.filter((f) => fields.includes(f));
  return present.length === 0 ? "control" : present.join("+");
}

/** Builds a config by spreading the IMPORTED production default and overriding only the named fields. */
export function rpConfigForFields(fields: readonly RpArmField[]): RpLayerConfig {
  let config: RpLayerConfig = { ...RP_LAYER_CONFIG_DEFAULT };
  for (const field of RP_ARM_FIELDS) {
    if (fields.includes(field)) config = { ...config, ...RP_ARM_FIELD_SHIP_VALUES[field] };
  }
  return config;
}

function requireVerdict(verdicts: ReadonlyMap<string, RpArmVerdict>, arm: string): RpArmVerdict {
  const v = verdicts.get(arm);
  if (v === undefined) {
    throw new Error(`decideRpShipConfig: the rule needs arm "${arm}"'s verdict and the map does not carry it — refusing to default rather than deciding on an arm that was never measured`);
  }
  return v;
}

/**
 * D-09's bar applied per field (D-10), in exactly three pre-committed steps
 * and nothing else.
 *
 * 1. PER-FIELD GATE. Each single-change arm (`win`, `tie`, `marginal`) is
 *    evaluated against `control`. Every field whose arm meets the bar enters
 *    the provisional accept set.
 * 2. COMBINATION GATE. The arm formed from the provisional set is itself
 *    evaluated against `control` and must also meet the bar — three changes
 *    that each help alone can interact badly, and the combination is what
 *    would actually ship. If it fails, drop the single field with the SMALLEST
 *    number of improved cells (ties broken by `RP_ARM_DROP_ORDER`) and
 *    evaluate the reduced combination ONCE. AT MOST ONE DROP. If the reduced
 *    combination still fails, the decision is `control` for all three fields.
 * 3. LEAVE-ONE-OUT is recorded for the reader and read by no step of this rule.
 *
 * That is at most three evaluations of the reporting slice, all defined before
 * any of them ran, which is what bounds D-04's one-way spend to a single event
 * even though the attribution table has eight arms in it. A second drop is
 * exactly the "one more look" that would spend the slice twice, so it is not
 * reachable even by accident.
 *
 * A verdict the rule needs and the map does not carry THROWS. Defaulting would
 * let a decision be taken on an arm that was never measured.
 */
export function decideRpShipConfig(verdicts: ReadonlyMap<string, RpArmVerdict>): RpShipDecision {
  const path: string[] = [];

  // ---- Step 1: the per-field gate ----
  const provisional: RpArmField[] = [];
  for (const field of RP_ARM_FIELDS) {
    const v = requireVerdict(verdicts, field);
    path.push(
      `per-field gate: "${field}" scored=${v.scored} improved=${v.improved} regressed=${v.regressed} tied=${v.tied} -> ${v.meetsBar ? "PASS" : "FAIL"}`
    );
    if (v.meetsBar) provisional.push(field);
  }

  const revert = (reason: string): RpShipDecision => {
    path.push(reason);
    return {
      shipConfig: { ...RP_LAYER_CONFIG_DEFAULT },
      acceptedFields: [],
      revertedFields: [...RP_ARM_FIELDS],
      path,
    };
  };

  if (provisional.length === 0) {
    return revert("no single-change arm met the bar — nothing to combine, and no combination was evaluated");
  }

  const accept = (fields: readonly RpArmField[]): RpShipDecision => ({
    shipConfig: rpConfigForFields(fields),
    acceptedFields: RP_ARM_FIELDS.filter((f) => fields.includes(f)),
    revertedFields: RP_ARM_FIELDS.filter((f) => !fields.includes(f)),
    path,
  });

  // ---- Step 2: the combination gate ----
  if (provisional.length === 1) {
    // The provisional set of size one IS the single-change arm, whose verdict
    // step 1 already computed and which already passed. There is no second
    // evaluation to make.
    path.push(
      `combination gate: the provisional set is the single-change arm "${provisional[0]}" — its own verdict, already computed, is the combination gate`
    );
    return accept(provisional);
  }

  const fullName = rpArmNameForFields(provisional);
  const full = requireVerdict(verdicts, fullName);
  path.push(
    `combination gate: "${fullName}" scored=${full.scored} improved=${full.improved} regressed=${full.regressed} tied=${full.tied} -> ${full.meetsBar ? "PASS" : "FAIL"}`
  );
  if (full.meetsBar) {
    path.push("combination gate passed — every provisionally accepted field ships");
    return accept(provisional);
  }

  // The single permitted drop: the field with the fewest improved cells in its
  // OWN single-change arm, ties broken by the fixed `RP_ARM_DROP_ORDER`.
  let dropped: RpArmField | undefined;
  let droppedImproved = Number.POSITIVE_INFINITY;
  for (const field of RP_ARM_DROP_ORDER) {
    if (!provisional.includes(field)) continue;
    const improved = requireVerdict(verdicts, field).improved;
    if (improved < droppedImproved) {
      dropped = field;
      droppedImproved = improved;
    }
  }
  const dropField = dropped!;
  path.push(
    `combination gate failed — dropping "${dropField}" (fewest improved cells, ${droppedImproved}; ties broken by the fixed order ${RP_ARM_DROP_ORDER.join(", ")})`
  );

  const reduced = provisional.filter((f) => f !== dropField);
  if (reduced.length === 1) {
    path.push(
      `reduced combination: the set is the single-change arm "${reduced[0]}" — its own verdict, already computed, is the gate`
    );
    return accept(reduced);
  }

  const reducedName = rpArmNameForFields(reduced);
  const reducedVerdict = requireVerdict(verdicts, reducedName);
  path.push(
    `reduced combination gate: "${reducedName}" scored=${reducedVerdict.scored} improved=${reducedVerdict.improved} regressed=${reducedVerdict.regressed} tied=${reducedVerdict.tied} -> ${reducedVerdict.meetsBar ? "PASS" : "FAIL"}`
  );
  if (reducedVerdict.meetsBar) return accept(reduced);

  return revert(
    "reduced combination gate failed — at most one drop is permitted, so there is no second drop; the decision is the legacy default for all three fields"
  );
}

// ---------------------------------------------------------------------------
// THE ARM REGISTRY AND D-04's TWO SLICES (09-06 Task 1 Step 2)
// ---------------------------------------------------------------------------

/** One named arm: a name the verdict map is keyed by, and the config it runs. */
export interface RpArm {
  readonly name: string;
  readonly config: RpLayerConfig;
}

/**
 * The eight arms — the full cross product of the three fields' declared
 * unions — with `control` (all-legacy) FIRST.
 *
 * Every config is built by spreading the IMPORTED production default and
 * overriding the fields that arm names (`rpConfigForFields`), never from
 * literal member strings written out here. A member renamed upstream is then
 * a compile error in `RP_ARM_FIELD_SHIP_VALUES` rather than a silently wrong
 * arm that measures the legacy path under a new label.
 *
 * `control` is THE HONEST BASELINE and it is the left-hand side of D-09's bar.
 * It is the all-legacy config running on 09-04's CLOSED FORM. It is NOT
 * 09-01's frozen `data/baselines/rp-calibration-2026-09.json`, which was
 * captured before 09-04 replaced the 4,000-draw Monte Carlo: D-10 ships that
 * engine change unconditionally, so scoring a modelling arm against the frozen
 * file would credit or blame the modelling changes for the Monte Carlo's
 * removal, and would compare a HEAD-computed number against one produced by
 * code that no longer exists.
 */
export const RP_ATTRIBUTION_ARMS: readonly RpArm[] = (
  [
    [],
    ["win"],
    ["tie"],
    ["marginal"],
    ["win", "tie"],
    ["win", "marginal"],
    ["tie", "marginal"],
    ["win", "tie", "marginal"],
  ] as readonly (readonly RpArmField[])[]
).map((fields) => ({ name: rpArmNameForFields(fields), config: rpConfigForFields(fields) }));

/**
 * D-04's CHOOSING slice. These seasons were free to inform the marginal-family
 * choice and 09-03's warm-roster record is drawn from them. 2021 is a
 * permanent exclusion (no registered RP rules), not a gap to fill.
 */
export const RP_SELECTION_SLICE_SEASONS: readonly number[] = [2016, 2017, 2018, 2019, 2020, 2022];

/**
 * D-04's REPORTING slice. D-09's ship bar is evaluated here and the published
 * calibration headline is taken here. These seasons had NO say in the family
 * choice, which is what makes the published figure out-of-sample and free of a
 * disclosure caveat. Looked at exactly once, against a rule frozen beforehand.
 */
export const RP_REPORTING_SLICE_SEASONS: readonly number[] = [2023, 2024, 2025, 2026];

/**
 * `"all"` or a comma-separated arm-name list, always returned in REGISTRY
 * order so two invocations naming the same arms produce identically-ordered
 * output. `undefined` returns `control` alone, so every pre-existing
 * invocation of this script keeps its current meaning.
 *
 * An unknown name throws, naming the unknown arm and listing the valid ones —
 * a typo'd arm silently resolving to something else is how a measurement ends
 * up describing a model nobody ran.
 */
export function resolveRpArms(spec?: string): readonly RpArm[] {
  if (spec === undefined) return RP_ATTRIBUTION_ARMS.filter((a) => a.name === "control");
  if (spec.trim() === "all") return RP_ATTRIBUTION_ARMS;
  const requested = spec
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const valid = RP_ATTRIBUTION_ARMS.map((a) => a.name);
  for (const name of requested) {
    if (!valid.includes(name)) {
      throw new Error(`resolveRpArms: unknown arm "${name}" — valid arms are ${valid.join(", ")} (or "all")`);
    }
  }
  return RP_ATTRIBUTION_ARMS.filter((a) => requested.includes(a.name));
}

/**
 * ONE SCORED CELL PER (arm, algorithmId, season, bonusName), accumulated
 * in-flight and read back per slice. Keyed as a flat string so a cell cannot
 * be matched by position anywhere in this script.
 */
export function rpCellKey(arm: string, algorithmId: string, season: number, bonusName: string): string {
  return `${arm}|${algorithmId}|${season}|${bonusName}`;
}

/**
 * THE IDENTICAL-POPULATION GUARD (09-06 Task 1 Step 4).
 *
 * Asserts that every selected arm scored the SAME NUMBER of observations for
 * every `(algorithmId, season, bonusName)` triple.
 *
 * The arms genuinely cannot differ here, and that is the point.
 * `SigmaScoutLayer.#rpFieldsFor` evaluates its eligibility gates — no rule
 * module, an RP-ineligible event type, and the alliance band guard — BEFORE it
 * reaches `analyticRpPmf` and therefore before any config branch runs. The set
 * of scored `(match, alliance, bonus)` observations is fixed by those gates
 * alone. So a difference in counts does not mean "this arm saw fewer matches";
 * it means something is wired wrong — an arm folding a different record
 * stream, a layer shared between arms, or an accumulator keyed by the wrong
 * arm name. Catching that here is cheap; discovering it inside a published
 * accuracy claim is not, and D-09's bar reads a per-cell Brier that a
 * differing denominator would silently corrupt.
 */
export function assertIdenticalPopulations(
  counts: ReadonlyMap<string, number>,
  arms: readonly RpArm[],
  algorithmIds: readonly string[],
  season: number,
  bonusNames: readonly string[]
): void {
  if (arms.length < 2) return;
  for (const algorithmId of algorithmIds) {
    for (const bonusName of bonusNames) {
      const observed = arms.map((arm) => ({
        arm: arm.name,
        count: counts.get(rpCellKey(arm.name, algorithmId, season, bonusName)) ?? 0,
      }));
      const first = observed[0]!.count;
      const differing = observed.filter((o) => o.count !== first);
      if (differing.length > 0) {
        throw new Error(
          `identical-population guard FAILED for (${algorithmId}, ${season}, ${bonusName}): ` +
            `${observed.map((o) => `${o.arm}=${o.count}`).join(", ")} — ` +
            `every arm must score the identical observation set because #rpFieldsFor's ` +
            `eligibility gates run before any config branch; a difference means an arm is wired wrong`
        );
      }
    }
  }
}

/** A `MarginalResolutionTally` summed across several layers, for one arm's readout. */
export function sumMarginalTallies(tallies: readonly MarginalResolutionTally[]): MarginalResolutionTally {
  const total = emptyMarginalResolutionTally();
  for (const t of tallies) {
    total.negativeBinomial += t.negativeBinomial;
    total.gaussian += t.gaussian;
    total.degenerate += t.degenerate;
    total.fallbacks += t.fallbacks;
  }
  return total;
}

/**
 * The share of an arm's fits that RESOLVED to negative binomial. Read from
 * `FittedMarginal.resolved`, never `.declared` — 09-03 refused to collapse the
 * two into one field and 09-05 made the distinction countable, precisely so
 * this plan cannot publish an accept/revert call for an arm labelled
 * `"negative-binomial"` that silently resolved to Gaussian on a large share of
 * its fits. `fallbacks` is counted SEPARATELY: a declared Gaussian default is
 * not a fallback, and conflating the two would overstate how much of the arm
 * actually ran the model its name claims.
 */
export function negativeBinomialShare(tally: MarginalResolutionTally): number {
  const total = tally.negativeBinomial + tally.gaussian + tally.degenerate;
  return total === 0 ? Number.NaN : tally.negativeBinomial / total;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasonsSpec = args[args.indexOf("--seasons") + 1] ?? "2023-2026";
  // Task 2 widening (D-09): absent --algorithm now resolves to EVERY
  // published algorithm — `resolvePublishAlgorithms(undefined)`'s own
  // documented default — rather than this script's old single-algorithm
  // "bpr" default. `--algorithm` itself already accepted a comma-separated
  // list before this change (`resolvePublishAlgorithms`'s own parsing); this
  // script previously just discarded everything after `[0]`.
  const algorithmIdsCsv = args.indexOf("--algorithm") === -1 ? undefined : args[args.indexOf("--algorithm") + 1]!;
  const emitArtifactPath = args.indexOf("--emit-artifact") === -1 ? undefined : args[args.indexOf("--emit-artifact") + 1];
  // 09-06 Task 1 Step 2 (D-09/D-11): `--arms` DEFAULTS TO `control` ALONE, so
  // every pre-existing invocation of this script — including the audit's own
  // reproduction command — keeps exactly its current meaning.
  const armsSpec = args.indexOf("--arms") === -1 ? undefined : args[args.indexOf("--arms") + 1]!;
  const seasons = parseSeasons(seasonsSpec).filter((s) => RP_RULE_MODULES[s] !== undefined);
  const algorithms = resolvePublishAlgorithms(algorithmIdsCsv);
  if (algorithms.length === 0) throw new Error(`no algorithms resolved from "${algorithmIdsCsv ?? "(default)"}"`);
  const arms = resolveRpArms(armsSpec);

  console.log(`RP calibration — algorithms [${algorithms.map((a) => `${a.id}@${a.version}`).join(", ")}], seasons ${seasons.join(", ")}`);
  console.log(`arms [${arms.map((a) => a.name).join(", ")}] — every one through the SAME imported SigmaScoutLayer, in this one process, at this one commit.`);
  console.log(`Walk-forward through the same SigmaScoutLayer the publisher runs.\n`);

  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    // Pooled PER (ALGORITHM, ARM) across seasons — mixing algorithms into one
    // pooled figure would average away exactly the per-algorithm comparison
    // D-09/D-11 need, and mixing arms would average away the comparison this
    // whole plan exists to make.
    const allMarginal = new Map<string, Observation[]>();
    const allPairs = new Map<string, { p1: number; p2: number; a1: boolean; a2: boolean }[]>();
    for (const a of algorithms) {
      for (const arm of arms) {
        allMarginal.set(`${a.id}|${arm.name}`, []);
        allPairs.set(`${a.id}|${arm.name}`, []);
      }
    }
    // One scored cell per (arm, algorithmId, season, bonusName) — the unit of
    // account D-09's bar reads. Keyed, never positional.
    const cellsByArm = new Map<string, RpBonusCell[]>(arms.map((arm) => [arm.name, []]));
    // Each arm's running resolved-family mix, summed over every layer it owns.
    const talliesByArm = new Map<string, MarginalResolutionTally[]>(arms.map((arm) => [arm.name, []]));
    const emittedRecords: { season: number; algorithmId: string; calibration: RpCalibrationRecord }[] = [];
    const emitArm = arms[0]!;

    for (const season of seasons) {
      const ruleModule = RP_RULE_MODULES[season]!;
      // Built ONCE per season and shared across every algorithm AND every arm
      // — the publisher's own `Map<string, SigmaScoutLayer>` shape
      // (`publish.ts`'s season loop), folded from one shared record list. The
      // ARMS MULTIPLY LAYERS, NEVER REPLAYS: one `runAll` per season however
      // many arms are selected, which is what makes "one replay per season"
      // in D-11's mitigation a literal statement about this loop.
      const stream = buildSeasonStream(db, season, { includeOffseason: true });
      const teams = Array.from(new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
      const records = new WalkForwardSimulator(stream).runAll(algorithms, teams);
      const actualFlags = actualBonusFlagsForSeason(stream, season);

      // SAME-SCORER FIX (see header): the second constructor argument selects
      // Sigma-vs-Swing band variance exactly the way the publisher's own layer
      // construction does (publish.ts's season loop) — without it this script
      // silently scored a different band than the one it published. The third
      // is the arm's config (D-05). This is the ONE `SigmaScoutLayer`
      // construction site this file is allowed to have.
      const layers = new Map<string, Map<string, SigmaScoutLayer>>();
      for (const algorithm of algorithms) {
        const byArm = new Map<string, SigmaScoutLayer>();
        for (const arm of arms) byArm.set(arm.name, new SigmaScoutLayer(ruleModule, algorithm.id, arm.config));
        layers.set(algorithm.id, byArm);
      }
      const perBonus = new Map<string, Observation[][]>();
      const pairs = new Map<string, { p1: number; p2: number; a1: boolean; a2: boolean }[]>();
      for (const algorithm of algorithms) {
        for (const arm of arms) {
          perBonus.set(`${algorithm.id}|${arm.name}`, ruleModule.bonusNames.map(() => []));
          pairs.set(`${algorithm.id}|${arm.name}`, []);
        }
      }

      for (const r of records) {
        const actual = actualFlags.get(r.match.matchKey);
        const byArm = layers.get(r.algorithmId)!;
        for (const arm of arms) {
          // `foldPlayed` is called for EVERY record on EVERY arm, BEFORE the
          // missing-result skip below — it folds the played result into the
          // layer's accumulators, so skipping it for an unscoreable match
          // would leave that arm's layer in a different state from the
          // publisher's and change every later prediction. The skip is on the
          // ACCUMULATION, never on the fold.
          const enriched = byArm.get(arm.name)!.foldPlayed(r.match, r.prediction);
          if (actual === undefined || actual === null) continue;

          const key = `${r.algorithmId}|${arm.name}`;
          const bonusObs = perBonus.get(key)!;
          const pairObs = pairs.get(key)!;
          const pooled = allMarginal.get(key)!;

          for (const side of ["red", "blue"] as const) {
            const predictedBonuses = side === "red" ? enriched.prediction.redBonusRp : enriched.prediction.blueBonusRp;
            const actualBonuses = side === "red" ? actual.red : actual.blue;
            if (predictedBonuses === undefined) continue;
            if (predictedBonuses.length !== actualBonuses.length) continue;

            for (let i = 0; i < predictedBonuses.length; i++) {
              const observation = { predicted: predictedBonuses[i]!, actual: actualBonuses[i]! };
              bonusObs[i]!.push(observation);
              pooled.push(observation);
            }
            // The correlation claim needs the FIRST TWO bonuses of a season
            // together on the same alliance — the pair the diagonal block
            // claims are independent.
            if (predictedBonuses.length >= 2) {
              pairObs.push({ p1: predictedBonuses[0]!, p2: predictedBonuses[1]!, a1: actualBonuses[0]!, a2: actualBonuses[1]! });
            }
          }
        }
      }

      // ---- Step 4: the identical-population guard, in flight ----
      const counts = new Map<string, number>();
      for (const algorithm of algorithms) {
        for (const arm of arms) {
          const bonusObs = perBonus.get(`${algorithm.id}|${arm.name}`)!;
          for (const [i, name] of ruleModule.bonusNames.entries()) {
            counts.set(rpCellKey(arm.name, algorithm.id, season, name), bonusObs[i]!.length);
          }
        }
      }
      assertIdenticalPopulations(counts, arms, algorithms.map((a) => a.id), season, ruleModule.bonusNames);

      for (const algorithm of algorithms) {
        for (const arm of arms) {
          const key = `${algorithm.id}|${arm.name}`;
          const bonusObs = perBonus.get(key)!;
          allPairs.get(key)!.push(...pairs.get(key)!);
          // ---- Step 5: read the arm's resolved-family tally ----
          talliesByArm.get(arm.name)!.push(layers.get(algorithm.id)!.get(arm.name)!.rpMarginalResolutionTally);

          for (const [i, name] of ruleModule.bonusNames.entries()) {
            const observations = bonusObs[i]!;
            cellsByArm.get(arm.name)!.push({
              algorithmId: algorithm.id,
              season,
              bonusName: name,
              count: observations.length,
              meanPredicted: meanPredicted(observations),
              observedFrequency: rate(observations),
              brierScore: brier(observations),
            });
          }

          if (arm.name === emitArm.name) {
            emittedRecords.push({ season, algorithmId: algorithm.id, calibration: buildRpCalibrationRecord(ruleModule.bonusNames, bonusObs) });
          }

          const total = bonusObs.reduce((sum, b) => sum + b.length, 0);
          console.log(`── ${season} [${algorithm.id} / ${arm.name}] ── ${total} (alliance, bonus) observations`);
          if (total === 0) {
            console.log(`   no scored bonus observations this season\n`);
            continue;
          }

          for (const [i, name] of ruleModule.bonusNames.entries()) {
            const observations = bonusObs[i]!;
            if (observations.length === 0) continue;
            console.log(
              `   ${name}: n=${observations.length}  mean predicted=${meanPredicted(observations).toFixed(4)}  ` +
                `observed=${rate(observations).toFixed(4)}  Brier=${brier(observations).toFixed(4)}`
            );
            for (const line of reliabilityTable(observations)) console.log(line);
          }

          const pairObs = pairs.get(key)!;
          if (pairObs.length > 0) {
            const [n1, n2] = [ruleModule.bonusNames[0]!, ruleModule.bonusNames[1]!];
            const both = pairObs.filter((p) => p.a1 && p.a2).length / pairObs.length;
            const rateA = pairObs.filter((p) => p.a1).length / pairObs.length;
            const rateB = pairObs.filter((p) => p.a2).length / pairObs.length;
            const independentJoint = rateA * rateB;
            const modelJoint = pairObs.reduce((sum, p) => sum + p.p1 * p.p2, 0) / pairObs.length;
            console.log(
              `   JOINT (${n1} AND ${n2}): observed=${both.toFixed(4)}  ` +
                `if independent=${independentJoint.toFixed(4)}  model implies=${modelJoint.toFixed(4)}  ` +
                `real dependence=${both - independentJoint >= 0 ? "+" : ""}${(both - independentJoint).toFixed(4)}`
            );
          }
          console.log("");
        }
      }
    }

    // ---- Pooled headline claims, ONE PER (ALGORITHM, ARM) ----
    for (const algorithm of algorithms) {
      for (const arm of arms) {
        const key = `${algorithm.id}|${arm.name}`;
        const marginal = allMarginal.get(key)!;
        const pairObs = allPairs.get(key)!;
        if (marginal.length === 0) continue;

        console.log(`═══ POOLED [${algorithm.id} / ${arm.name}] ═══`);
        console.log(`${marginal.length} (alliance, bonus) observations across ${seasons.length} season(s)\n`);

        console.log(`OVERALL: mean predicted=${meanPredicted(marginal).toFixed(4)}  observed=${rate(marginal).toFixed(4)}  Brier=${brier(marginal).toFixed(4)}`);

        const confident = marginal.filter((o) => o.predicted < 0.05 || o.predicted > 0.95);
        const lowConfident = marginal.filter((o) => o.predicted < 0.05);
        const highConfident = marginal.filter((o) => o.predicted > 0.95);
        console.log(
          `\nTHE EXTREMES CLAIM — ${((confident.length / marginal.length) * 100).toFixed(1)}% of predictions are below 0.05 or above 0.95`
        );
        if (lowConfident.length > 0) {
          console.log(
            `   predicted <0.05: n=${lowConfident.length}  mean predicted=${meanPredicted(lowConfident).toFixed(4)}  ` +
              `ACTUALLY happened ${(rate(lowConfident) * 100).toFixed(2)}% of the time`
          );
        }
        if (highConfident.length > 0) {
          console.log(
            `   predicted >0.95: n=${highConfident.length}  mean predicted=${meanPredicted(highConfident).toFixed(4)}  ` +
              `ACTUALLY happened ${(rate(highConfident) * 100).toFixed(2)}% of the time`
          );
        }

        if (pairObs.length > 0) {
          const both = pairObs.filter((p) => p.a1 && p.a2).length / pairObs.length;
          const rateA = pairObs.filter((p) => p.a1).length / pairObs.length;
          const rateB = pairObs.filter((p) => p.a2).length / pairObs.length;
          const independentJoint = rateA * rateB;
          const modelJoint = pairObs.reduce((sum, p) => sum + p.p1 * p.p2, 0) / pairObs.length;
          console.log(`\nTHE CORRELATION CLAIM — n=${pairObs.length} alliance-matches carrying two bonuses`);
          console.log(`   observed P(both)                     = ${both.toFixed(4)}`);
          console.log(`   P(A)*P(B), i.e. if truly independent = ${independentJoint.toFixed(4)}`);
          console.log(`   the model's own implied P(both)      = ${modelJoint.toFixed(4)}`);
          const dependence = both - independentJoint;
          console.log(
            `   REAL dependence the diagonal block discards = ${dependence >= 0 ? "+" : ""}${dependence.toFixed(4)} ` +
              `(${dependence > 0 ? "POSITIVE — the two go together more often than independence predicts, as the header expected" : "NEGATIVE — the two go together LESS often than independence predicts, opposite to what the header expected"})`
          );
        }
        console.log("");
      }
    }

    // ---- Step 5's readout: the resolved-family mix, per arm ----
    console.log(`═══ RESOLVED-FAMILY MIX (FittedMarginal.resolved, never .declared) ═══`);
    for (const arm of arms) {
      const tally = sumMarginalTallies(talliesByArm.get(arm.name)!);
      const share = negativeBinomialShare(tally);
      console.log(
        `   ${arm.name.padEnd(18)} negative-binomial=${tally.negativeBinomial}  gaussian=${tally.gaussian}  ` +
          `degenerate=${tally.degenerate}  (fallbacks counted separately: ${tally.fallbacks})  ` +
          `NB share=${Number.isNaN(share) ? "n/a" : `${(share * 100).toFixed(2)}%`}`
      );
    }
    console.log("");

    // ---- Grand-pooled headline, across EVERY algorithm AND season, for the
    // EMITTED arm — the single figure 09-01-SUMMARY.md sets beside
    // ranking-points-audit.md F2's recorded 0.1507 / 0.3109. Computed directly
    // from the emitted records so it matches whatever byte the measurement
    // file itself carries, never a separate re-derivation.
    const grandPooled = emittedRecords.flatMap((r) =>
      r.calibration.bonuses.map((b) => ({ p: b.meanPredicted, o: b.observedFrequency, n: b.count }))
    );
    if (grandPooled.length > 0) {
      const totalN = grandPooled.reduce((sum, g) => sum + g.n, 0);
      const grandMeanPredicted = grandPooled.reduce((sum, g) => sum + g.p * g.n, 0) / totalN;
      const grandObserved = grandPooled.reduce((sum, g) => sum + g.o * g.n, 0) / totalN;
      console.log(`═══ GRAND POOLED (every algorithm, every season) [arm: ${emitArm.name}] ═══`);
      console.log(`n=${totalN}  mean predicted=${grandMeanPredicted.toFixed(4)}  observed=${grandObserved.toFixed(4)}`);
    }

    // ---- D-09's bar, applied to whatever slice of seasons was just run ----
    // NOTHING IS DECIDED HERE. The bar's verdict is printed for every
    // non-control arm so a reader can see the machinery working; the actual
    // per-field ship/revert call is taken ONCE, on the WHOLE reporting slice,
    // at this plan's checkpoint. A verdict printed over a partial season list
    // is a demonstration, not a decision.
    const controlCells = cellsByArm.get("control");
    if (controlCells !== undefined && arms.length > 1) {
      console.log(`\n═══ D-09 BAR over seasons ${seasons.join(", ")} — DEMONSTRATION, NOTHING IS DECIDED HERE ═══`);
      for (const arm of arms) {
        if (arm.name === "control") continue;
        const v = evaluateD09Bar(controlCells, cellsByArm.get(arm.name)!, arm.name);
        console.log(
          `   ${v.arm.padEnd(18)} scored=${v.scored}  improved=${v.improved}  regressed=${v.regressed}  tied=${v.tied}  ` +
            `meetsBar=${v.meetsBar}`
        );
      }
    }

    if (emitArtifactPath !== undefined) {
      const candidate = {
        measuredAt: new Date().toISOString(),
        command: `npx tsx scripts/measureRpCalibration.ts ${args.join(" ")}`,
        corpusIdentity: CORPUS_PATH,
        // The stream above is built with `includeOffseason: true` and this
        // task does not change that — the number's population is recorded
        // here rather than quietly altered.
        offseasonIncluded: true,
        algorithmVersions: Object.fromEntries(algorithms.map((a) => [a.id, a.version])),
        records: emittedRecords,
      };
      const parsed = RpCalibrationMeasurementSchema.parse(candidate);
      writeFileSync(emitArtifactPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
      console.log(`\nwrote ${emitArtifactPath} (arm: ${emitArm.name})`);
    }
  } finally {
    db.close();
  }
}

// Guard: only auto-run `main()` when this file is the process entry point, so
// the pure helpers above can be imported by the test file without the harness
// trying to open a corpus. Same idiom as `measureEpaDeviations.ts`.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("measure:rp-calibration failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
