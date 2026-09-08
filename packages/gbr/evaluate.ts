/**
 * Rolling-origin evaluation. Train on every design year strictly before
 * `originSeason` through ONE continuous feature engine, bin and fit the
 * requested heads once, then continue the SAME state walk-forward into the
 * origin season with NO refit — a pure cross-season generalization test.
 *
 * This file must never reference the seal-break option or the sealed year
 * set, comments included — see `seal.test.ts`'s comment-stripped source
 * scan, which runs against this exact file.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DESIGN_YEARS } from "./cli.js";
import { isEligible, loadSeason, type GbrMatch } from "./data.js";
import {
  carrySeason,
  extractFeatures,
  FEATURE_NAMES,
  initSeasonState,
  negateFeatures,
  seasonSd,
  updateStates,
  type FeatureParams,
} from "./features.js";
import { applyBinner, buildBinner, fitForest, predictForest, type GbdtParams, type SerializedForest } from "./gbdt.js";

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/** P-9's symmetrized inference: `p = (sigmoid(F(x)) + 1 - sigmoid(F(negate(x)))) / 2`. */
function symmetrizedWinProb(model: SerializedForest, x: Float64Array): number {
  const px = sigmoid(predictForest(model, x));
  const pNeg = sigmoid(predictForest(model, negateFeatures(x)));
  return (px + (1 - pNeg)) / 2;
}

/** P-9's symmetrized inference: `m = (G(x) - G(negate(x))) / 2`. */
function symmetrizedMargin(model: SerializedForest, x: Float64Array): number {
  return (predictForest(model, x) - predictForest(model, negateFeatures(x))) / 2;
}

/** P-9's symmetrized inference: `t = (H(x) + H(negate(x))) / 2`. */
function symmetrizedTotal(model: SerializedForest, x: Float64Array): number {
  return (predictForest(model, x) + predictForest(model, negateFeatures(x))) / 2;
}

export interface RunOriginOptions {
  heads: "win" | "all";
  nTrees: number;
  maxDepth: number;
  learningRate: number;
  minChildWeight: number;
  lambda: number;
  subsample: number;
  colsampleByTree: number;
  seed: number;
  halflife: number;
  prevSeasonDecay: number;
  verbose?: boolean;
}

export interface OriginCounts {
  trainStreamed: number;
  trainingRows: number;
  trainSkippedNoTeams: number;
  evalStreamed: number;
  evalScored: number;
  evalTies: number;
  evalSkippedNoTeams: number;
  evalQuals: number;
  evalElims: number;
}

export interface CalibrationRow {
  bin: number;
  n: number;
  meanPredicted: number;
  observedFrequency: number;
}

export interface OriginResult {
  originSeason: number;
  trainYears: number[];
  counts: OriginCounts;
  winnerAccuracy: number;
  brier: number;
  qualsAccuracy: number;
  elimsAccuracy: number;
  calibration: CalibrationRow[];
  fitMs: number;
  /** Mean absolute error of the symmetrized margin/total heads against the same-normalization label, `undefined` under `--heads win` (P-7: those heads are never fit). */
  marginMae?: number;
  totalMae?: number;
}

interface TrainRow {
  x: Float64Array;
  win: number;
  marginZ: number;
  totalZ: number;
}

/**
 * P-9's eligibility-driven skip: an alliance with zero teams is skipped
 * entirely (2v2 offseason events exist) rather than fed to `extractFeatures`,
 * which throws on an empty alliance by contract.
 */
function hasTeams(match: GbrMatch): boolean {
  return match.redTeams.length > 0 && match.blueTeams.length > 0;
}

export function runOrigin(originSeason: number, opts: RunOriginOptions): OriginResult {
  const featureParams: FeatureParams = { halflife: opts.halflife, prevSeasonDecay: opts.prevSeasonDecay };
  const trainYears = DESIGN_YEARS.filter((y) => y < originSeason);
  if (trainYears.length === 0) {
    throw new Error(`runOrigin: no design years precede origin ${originSeason}`);
  }

  let state = initSeasonState(trainYears[0]!);
  const trainRows: TrainRow[] = [];
  let trainStreamed = 0;
  let trainSkippedNoTeams = 0;

  for (let i = 0; i < trainYears.length; i += 1) {
    const year = trainYears[i]!;
    const matches = loadSeason(year);
    trainStreamed += matches.length;
    for (const match of matches) {
      if (!hasTeams(match)) {
        trainSkippedNoTeams += 1;
        continue;
      }
      const features = extractFeatures(state, match);
      if (isEligible(match)) {
        const sd = seasonSd(state);
        const mean = state.mean;
        trainRows.push({
          x: features,
          win: match.winner === "red" ? 1 : 0,
          marginZ: (match.redScore - match.blueScore) / sd,
          totalZ: ((match.redScore + match.blueScore) / 2 - mean) / sd,
        });
      }
      updateStates(state, match, featureParams);
    }
    const nextYear = i + 1 < trainYears.length ? trainYears[i + 1]! : originSeason;
    state = carrySeason(state, nextYear, featureParams);
  }

  const nRows = trainRows.length;
  const nFeatures = FEATURE_NAMES.length;
  const X = new Float64Array(nRows * nFeatures);
  const yWin = new Float64Array(nRows);
  const yMargin = new Float64Array(nRows);
  const yTotal = new Float64Array(nRows);
  for (let r = 0; r < nRows; r += 1) {
    const row = trainRows[r]!;
    X.set(row.x, r * nFeatures);
    yWin[r] = row.win;
    yMargin[r] = row.marginZ;
    yTotal[r] = row.totalZ;
  }

  const binner = buildBinner(X, nRows, nFeatures);
  const binned = applyBinner(binner, X, nRows);

  const gbdtParams: GbdtParams = {
    nTrees: opts.nTrees,
    maxDepth: opts.maxDepth,
    learningRate: opts.learningRate,
    minChildWeight: opts.minChildWeight,
    lambda: opts.lambda,
    subsample: opts.subsample,
    colsampleByTree: opts.colsampleByTree,
    seed: opts.seed,
    verbose: opts.verbose,
  };

  const fitStart = Date.now();
  const winModel = fitForest(gbdtParams, binner, binned, nRows, nFeatures, yWin, "logistic");
  // P-7: evaluate.ts defaults to --heads all; tune.ts defaults to --heads
  // win (neither reads margin/total, so fitting them would triple search
  // cost for information the objective discards). Selected parameters apply
  // to all three heads unchanged — this is a flag, not a model change.
  let marginModel: SerializedForest | null = null;
  let totalModel: SerializedForest | null = null;
  if (opts.heads === "all") {
    marginModel = fitForest(gbdtParams, binner, binned, nRows, nFeatures, yMargin, "squared");
    totalModel = fitForest(gbdtParams, binner, binned, nRows, nFeatures, yTotal, "squared");
  }
  const fitMs = Date.now() - fitStart;

  const evalMatches = loadSeason(originSeason);
  const evalStreamed = evalMatches.length;
  let evalSkippedNoTeams = 0;
  let evalTies = 0;
  let evalScored = 0;
  let evalQuals = 0;
  let evalElims = 0;
  let correct = 0;
  let decided = 0;
  let brierSum = 0;
  let qualsCorrect = 0;
  let qualsDecided = 0;
  let elimsCorrect = 0;
  let elimsDecided = 0;
  let marginAbsErrSum = 0;
  let totalAbsErrSum = 0;
  const calibBins = Array.from({ length: 10 }, () => ({ n: 0, sumPredicted: 0, sumObserved: 0 }));

  for (const match of evalMatches) {
    if (!hasTeams(match)) {
      evalSkippedNoTeams += 1;
      continue;
    }
    const features = extractFeatures(state, match);
    if (isEligible(match)) {
      const pRedWin = symmetrizedWinProb(winModel, features);
      const actualRed = match.winner === "red" ? 1 : 0;
      evalScored += 1;
      brierSum += (pRedWin - actualRed) ** 2;

      if (marginModel !== null && totalModel !== null) {
        // Same-normalization labels as training (P-9's label definition,
        // computed from the PRE-update stats extractFeatures just used).
        const sd = seasonSd(state);
        const mean = state.mean;
        const actualMarginZ = (match.redScore - match.blueScore) / sd;
        const actualTotalZ = ((match.redScore + match.blueScore) / 2 - mean) / sd;
        marginAbsErrSum += Math.abs(symmetrizedMargin(marginModel, features) - actualMarginZ);
        totalAbsErrSum += Math.abs(symmetrizedTotal(totalModel, features) - actualTotalZ);
      }

      const isElim = match.compLevel !== "qm";
      if (isElim) evalElims += 1;
      else evalQuals += 1;

      if (pRedWin !== 0.5) {
        decided += 1;
        const predictedRed = pRedWin > 0.5;
        const gotIt = predictedRed ? actualRed === 1 : actualRed === 0;
        if (gotIt) correct += 1;
        if (isElim) {
          elimsDecided += 1;
          if (gotIt) elimsCorrect += 1;
        } else {
          qualsDecided += 1;
          if (gotIt) qualsCorrect += 1;
        }
      }

      const binIdx = Math.min(9, Math.max(0, Math.floor(pRedWin * 10)));
      const bin = calibBins[binIdx]!;
      bin.n += 1;
      bin.sumPredicted += pRedWin;
      bin.sumObserved += actualRed;
    } else if (match.winner === "tie") {
      evalTies += 1;
    }
    updateStates(state, match, featureParams);
  }

  const calibration: CalibrationRow[] = calibBins.map((b, i) => ({
    bin: i,
    n: b.n,
    meanPredicted: b.n > 0 ? b.sumPredicted / b.n : 0,
    observedFrequency: b.n > 0 ? b.sumObserved / b.n : 0,
  }));

  return {
    originSeason,
    trainYears: [...trainYears],
    counts: {
      trainStreamed,
      trainingRows: nRows,
      trainSkippedNoTeams,
      evalStreamed,
      evalScored,
      evalTies,
      evalSkippedNoTeams,
      evalQuals,
      evalElims,
    },
    winnerAccuracy: decided > 0 ? correct / decided : 0,
    brier: evalScored > 0 ? brierSum / evalScored : 0,
    qualsAccuracy: qualsDecided > 0 ? qualsCorrect / qualsDecided : 0,
    elimsAccuracy: elimsDecided > 0 ? elimsCorrect / elimsDecided : 0,
    calibration,
    fitMs,
    ...(marginModel !== null && totalModel !== null
      ? { marginMae: marginAbsErrSum / evalScored, totalMae: totalAbsErrSum / evalScored }
      : {}),
  };
}

// --- measured expectations, transcribed from the plan's corpus table -------

const MEASURED: Readonly<
  Record<number, { streamed: number; trainingRows: number; evalStreamed: number; evalScored: number; evalTies: number }>
> = {
  2022: { streamed: 80791, trainingRows: 79556, evalStreamed: 18012, evalScored: 17710, evalTies: 200 },
  2023: { streamed: 98803, trainingRows: 97266, evalStreamed: 20194, evalScored: 19919, evalTies: 179 },
  2024: { streamed: 118997, trainingRows: 117185, evalStreamed: 22099, evalScored: 21722, evalTies: 248 },
  2025: { streamed: 141096, trainingRows: 138907, evalStreamed: 23792, evalScored: 23462, evalTies: 153 },
};

function reportCounts(origin: number, counts: OriginCounts): void {
  console.log(`streamed=${counts.trainStreamed}`);
  console.log(`trainingRows=${counts.trainingRows}`);
  console.log(`evalStreamed=${counts.evalStreamed}`);
  console.log(`scored=${counts.evalScored}`);
  console.log(`ties=${counts.evalTies}`);

  const expected = MEASURED[origin];
  if (expected === undefined) {
    console.log(`(no measured expectation embedded for origin ${origin})`);
    return;
  }
  const checks: Array<[string, number, number]> = [
    ["streamed", counts.trainStreamed, expected.streamed],
    ["trainingRows", counts.trainingRows, expected.trainingRows],
    ["evalStreamed", counts.evalStreamed, expected.evalStreamed],
    ["scored", counts.evalScored, expected.evalScored],
    ["ties", counts.evalTies, expected.evalTies],
  ];
  for (const [name, actual, exp] of checks) {
    if (actual !== exp) {
      console.warn(`WARNING: ${name} mismatch for origin ${origin} — expected ${exp}, got ${actual}`);
    }
  }
}

const DEFAULT_GBDT_KNOBS = {
  maxDepth: 5,
  learningRate: 0.1,
  minChildWeight: 5,
  lambda: 1,
  subsample: 0.8,
  colsampleByTree: 0.8,
  seed: 42,
  halflife: 10,
  prevSeasonDecay: 0.6,
} as const;

interface CliArgs {
  origin: number;
  quick: boolean;
  heads: "win" | "all";
  nTrees: number;
  noWrite: boolean;
}

function getFlag(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx === -1 ? undefined : argv[idx + 1];
}

function parseArgs(argv: string[]): CliArgs {
  const originArg = getFlag(argv, "--origin");
  if (originArg === undefined) throw new Error("evaluate.ts: --origin <year> is required");
  const origin = Number(originArg);
  if (!Number.isFinite(origin)) throw new Error(`evaluate.ts: invalid --origin "${originArg}"`);

  const quick = argv.includes("--quick");
  const headsArg = getFlag(argv, "--heads");
  const heads: "win" | "all" = quick ? "win" : headsArg === "all" ? "all" : "win";
  const treesArg = getFlag(argv, "--trees");
  const nTrees = quick ? 30 : treesArg !== undefined ? Number(treesArg) : 300;
  const noWrite = argv.includes("--no-write");

  return { origin, quick, heads, nTrees, noWrite };
}

function formatCalibrationTable(rows: readonly CalibrationRow[]): string {
  const lines = ["  bin      n  meanPred  observed"];
  for (const row of rows) {
    lines.push(
      `  ${String(row.bin).padStart(3)}  ${String(row.n).padStart(5)}  ${row.meanPredicted.toFixed(3).padStart(8)}  ${row.observedFrequency.toFixed(3).padStart(8)}`,
    );
  }
  return lines.join("\n");
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const opts: RunOriginOptions = { heads: args.heads, nTrees: args.nTrees, ...DEFAULT_GBDT_KNOBS, verbose: true };

  console.log(`GBR evaluate — origin ${args.origin}, heads=${opts.heads}, nTrees=${opts.nTrees}`);
  const result = runOrigin(args.origin, opts);

  console.log(`trainYears: ${result.trainYears.join(", ")}`);
  reportCounts(args.origin, result.counts);
  console.log(`skippedNoTeams: train=${result.counts.trainSkippedNoTeams} eval=${result.counts.evalSkippedNoTeams}`);
  console.log(`winnerAccuracy=${result.winnerAccuracy.toFixed(4)}`);
  console.log(`brier=${result.brier.toFixed(4)}`);
  console.log(`qualsAccuracy=${result.qualsAccuracy.toFixed(4)} (n=${result.counts.evalQuals})`);
  console.log(`elimsAccuracy=${result.elimsAccuracy.toFixed(4)} (n=${result.counts.evalElims})`);
  if (result.marginMae !== undefined && result.totalMae !== undefined) {
    console.log(`marginMae=${result.marginMae.toFixed(4)} totalMae=${result.totalMae.toFixed(4)} (z-units)`);
  }
  console.log(`fitMs=${result.fitMs}`);
  console.log("calibration:");
  console.log(formatCalibrationTable(result.calibration));

  if (!args.noWrite) {
    const dir = "packages/gbr/results";
    mkdirSync(dir, { recursive: true });
    const outPath = `${dir}/origin-${args.origin}.json`;
    writeFileSync(outPath, JSON.stringify({ origin: args.origin, heads: opts.heads, result }, null, 2));
    console.log(`wrote ${outPath}`);
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main();
}
