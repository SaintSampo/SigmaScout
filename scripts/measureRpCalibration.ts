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
 * Usage:
 *   npx tsx scripts/measureRpCalibration.ts [--seasons 2024-2026] [--algorithm bpr]
 */

import { openCorpusReadOnly } from "../packages/corpus/db.js";
import { buildSeasonStream, WalkForwardSimulator } from "../packages/harness/replay.js";
import { SigmaScoutLayer } from "../packages/harness/sigmaScoutLayer.js";
import { RP_RULE_MODULES } from "../packages/core/rankingPoints/rules.js";
import { actualBonusFlagsForSeason } from "../packages/harness/publish.js";
import { resolvePublishAlgorithms } from "../packages/harness/publish.js";

const CORPUS_PATH = "data/corpus.sqlite";

/** One (match, alliance, bonus) prediction paired with what happened. */
interface Observation {
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

const BUCKET_EDGES = [0, 0.05, 0.2, 0.4, 0.6, 0.8, 0.95, 1.0000001];

function reliabilityTable(observations: readonly Observation[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < BUCKET_EDGES.length - 1; i++) {
    const lo = BUCKET_EDGES[i]!;
    const hi = BUCKET_EDGES[i + 1]!;
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasonsSpec = args[args.indexOf("--seasons") + 1] ?? "2023-2026";
  const algorithmId = args.indexOf("--algorithm") === -1 ? "bpr" : args[args.indexOf("--algorithm") + 1]!;
  const seasons = parseSeasons(seasonsSpec).filter((s) => RP_RULE_MODULES[s] !== undefined);
  const algorithm = resolvePublishAlgorithms(algorithmId)[0];
  if (algorithm === undefined) throw new Error(`unknown algorithm "${algorithmId}"`);

  console.log(`RP calibration — algorithm "${algorithm.id}@${algorithm.version}", seasons ${seasons.join(", ")}`);
  console.log(`Walk-forward through the same SigmaScoutLayer the publisher runs.\n`);

  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    // Pooled across seasons, for the headline claims.
    const allMarginal: Observation[] = [];
    const allPairs: { p1: number; p2: number; a1: boolean; a2: boolean }[] = [];

    for (const season of seasons) {
      const ruleModule = RP_RULE_MODULES[season]!;
      const stream = buildSeasonStream(db, season, { includeOffseason: true });
      const teams = Array.from(new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
      const records = new WalkForwardSimulator(stream).runAll([algorithm], teams);
      const actualFlags = actualBonusFlagsForSeason(stream, season);

      const layer = new SigmaScoutLayer(ruleModule);
      const perBonus: Observation[][] = ruleModule.bonusNames.map(() => []);
      const pairs: { p1: number; p2: number; a1: boolean; a2: boolean }[] = [];

      for (const r of records) {
        const enriched = layer.foldPlayed(r.match, r.prediction);
        const actual = actualFlags.get(r.match.matchKey);
        if (actual === undefined || actual === null) continue;

        for (const side of ["red", "blue"] as const) {
          const predictedBonuses = side === "red" ? enriched.prediction.redBonusRp : enriched.prediction.blueBonusRp;
          const actualBonuses = side === "red" ? actual.red : actual.blue;
          if (predictedBonuses === undefined) continue;
          if (predictedBonuses.length !== actualBonuses.length) continue;

          for (let i = 0; i < predictedBonuses.length; i++) {
            const observation = { predicted: predictedBonuses[i]!, actual: actualBonuses[i]! };
            perBonus[i]!.push(observation);
            allMarginal.push(observation);
          }
          // The correlation claim needs the FIRST TWO bonuses of a season
          // together on the same alliance — the pair the diagonal block claims
          // are independent.
          if (predictedBonuses.length >= 2) {
            pairs.push({ p1: predictedBonuses[0]!, p2: predictedBonuses[1]!, a1: actualBonuses[0]!, a2: actualBonuses[1]! });
          }
        }
      }
      allPairs.push(...pairs);

      const total = perBonus.reduce((sum, b) => sum + b.length, 0);
      console.log(`── ${season} ── ${total} (alliance, bonus) observations`);
      if (total === 0) {
        console.log(`   no scored bonus observations this season\n`);
        continue;
      }

      for (const [i, name] of ruleModule.bonusNames.entries()) {
        const observations = perBonus[i]!;
        if (observations.length === 0) continue;
        console.log(
          `   ${name}: n=${observations.length}  mean predicted=${meanPredicted(observations).toFixed(4)}  ` +
            `observed=${rate(observations).toFixed(4)}  Brier=${brier(observations).toFixed(4)}`
        );
        for (const line of reliabilityTable(observations)) console.log(line);
      }

      if (pairs.length > 0) {
        const [n1, n2] = [ruleModule.bonusNames[0]!, ruleModule.bonusNames[1]!];
        const both = pairs.filter((p) => p.a1 && p.a2).length / pairs.length;
        const rateA = pairs.filter((p) => p.a1).length / pairs.length;
        const rateB = pairs.filter((p) => p.a2).length / pairs.length;
        const independentJoint = rateA * rateB;
        const modelJoint = pairs.reduce((sum, p) => sum + p.p1 * p.p2, 0) / pairs.length;
        console.log(
          `   JOINT (${n1} AND ${n2}): observed=${both.toFixed(4)}  ` +
            `if independent=${independentJoint.toFixed(4)}  model implies=${modelJoint.toFixed(4)}  ` +
            `real dependence=${both - independentJoint >= 0 ? "+" : ""}${(both - independentJoint).toFixed(4)}`
        );
      }
      console.log("");
    }

    // ---- Pooled headline claims ----
    console.log("═══ POOLED ═══");
    console.log(`${allMarginal.length} (alliance, bonus) observations across ${seasons.length} season(s)\n`);

    console.log(`OVERALL: mean predicted=${meanPredicted(allMarginal).toFixed(4)}  observed=${rate(allMarginal).toFixed(4)}  Brier=${brier(allMarginal).toFixed(4)}`);

    const confident = allMarginal.filter((o) => o.predicted < 0.05 || o.predicted > 0.95);
    const lowConfident = allMarginal.filter((o) => o.predicted < 0.05);
    const highConfident = allMarginal.filter((o) => o.predicted > 0.95);
    console.log(
      `\nTHE EXTREMES CLAIM — ${((confident.length / allMarginal.length) * 100).toFixed(1)}% of predictions are below 0.05 or above 0.95`
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

    if (allPairs.length > 0) {
      const both = allPairs.filter((p) => p.a1 && p.a2).length / allPairs.length;
      const rateA = allPairs.filter((p) => p.a1).length / allPairs.length;
      const rateB = allPairs.filter((p) => p.a2).length / allPairs.length;
      const independentJoint = rateA * rateB;
      const modelJoint = allPairs.reduce((sum, p) => sum + p.p1 * p.p2, 0) / allPairs.length;
      console.log(`\nTHE CORRELATION CLAIM — n=${allPairs.length} alliance-matches carrying two bonuses`);
      console.log(`   observed P(both)                     = ${both.toFixed(4)}`);
      console.log(`   P(A)*P(B), i.e. if truly independent = ${independentJoint.toFixed(4)}`);
      console.log(`   the model's own implied P(both)      = ${modelJoint.toFixed(4)}`);
      const dependence = both - independentJoint;
      console.log(
        `   REAL dependence the diagonal block discards = ${dependence >= 0 ? "+" : ""}${dependence.toFixed(4)} ` +
          `(${dependence > 0 ? "POSITIVE — the two go together more often than independence predicts, as the header expected" : "NEGATIVE — the two go together LESS often than independence predicts, opposite to what the header expected"})`
      );
    }
  } finally {
    db.close();
  }
}

await main();
