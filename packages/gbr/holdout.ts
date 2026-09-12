/**
 * SINGLE-SHOT holdout evaluation. Built, and proven to refuse — NOT run by
 * this task. This is the ONLY file in the package permitted to pass the
 * seal-break option (imported from `./cli.js`, referenced by name, never
 * spelled out in a string here — see `data.ts`'s `LoadSeasonOptions` for the
 * option itself).
 *
 * Refuses to run unless (a) invoked with `--break-seal`, AND (b) the frozen
 * parameter file exists, is tracked at `HEAD`, and has a clean working tree
 * for that path — `packages/spr/holdout.ts:17-39`'s `assertCommitted` is the
 * precedent this follows, in shape and in error message.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { HOLDOUT_YEARS, DESIGN_YEARS } from "./cli.js";
import { isEligible, loadSeason } from "./data.js";
import {
  carrySeason,
  extractFeatures,
  FEATURE_NAMES,
  initSeasonState,
  negateFeatures,
  updateStates,
  type FeatureParams,
} from "./features.js";
import { applyBinner, buildBinner, fitForest, predictForest, type GbdtParams } from "./gbdt.js";

const FROZEN_PARAMS_PATH = "packages/gbr/frozen-params.json";

function assertCommitted(path: string): string {
  let head: string;
  try {
    head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("holdout: not a git repository - refusing to run");
  }
  if (!existsSync(path)) {
    throw new Error(`holdout: ${path} does not exist - refusing to run without frozen parameters`);
  }
  const status = execFileSync("git", ["status", "--porcelain", "--", path], { encoding: "utf8" }).trim();
  if (status !== "") {
    throw new Error(
      `holdout: ${path} has uncommitted changes (${status}). Commit the frozen parameters first - the seal must predate the evaluation.`,
    );
  }
  try {
    execFileSync("git", ["cat-file", "-e", `HEAD:${path}`], { stdio: "ignore" });
  } catch {
    throw new Error(`holdout: ${path} is not tracked at HEAD - commit it first`);
  }
  return head;
}

interface FrozenParams extends GbdtParams {
  halflife: number;
  prevSeasonDecay: number;
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

function main(): void {
  if (!process.argv.includes("--break-seal")) {
    throw new Error(
      "holdout: refusing to run without --break-seal.\n" +
        "This evaluation is single-shot by design. Every extra run costs some of\n" +
        "the holdout's independence, so breaking the seal must be deliberate.",
    );
  }

  const head = assertCommitted(FROZEN_PARAMS_PATH);

  const raw = JSON.parse(readFileSync(FROZEN_PARAMS_PATH, "utf8")) as { params: FrozenParams };
  const params = raw.params;
  const featureParams: FeatureParams = { halflife: params.halflife, prevSeasonDecay: params.prevSeasonDecay };

  console.log(`GBR holdout evaluation`);
  console.log(`  frozen params: ${FROZEN_PARAMS_PATH} @ ${head}`);
  console.log(`  training years: ${DESIGN_YEARS.join(", ")}`);
  console.log(`  holdout year: ${HOLDOUT_YEARS.join(", ")}`);
  console.log("");

  let state = initSeasonState(DESIGN_YEARS[0]!);
  const trainRows: { x: Float64Array; win: number }[] = [];
  for (let i = 0; i < DESIGN_YEARS.length; i += 1) {
    const year = DESIGN_YEARS[i]!;
    const matches = loadSeason(year);
    for (const match of matches) {
      if (match.redTeams.length === 0 || match.blueTeams.length === 0) continue;
      const features = extractFeatures(state, match);
      if (isEligible(match)) {
        trainRows.push({ x: features, win: match.winner === "red" ? 1 : 0 });
      }
      updateStates(state, match, featureParams);
    }
    const nextYear = i + 1 < DESIGN_YEARS.length ? DESIGN_YEARS[i + 1]! : HOLDOUT_YEARS[0]!;
    state = carrySeason(state, nextYear, featureParams);
  }

  const nFeatures = FEATURE_NAMES.length;
  const nRows = trainRows.length;
  const X = new Float64Array(nRows * nFeatures);
  const y = new Float64Array(nRows);
  for (let r = 0; r < nRows; r += 1) {
    X.set(trainRows[r]!.x, r * nFeatures);
    y[r] = trainRows[r]!.win;
  }
  const binner = buildBinner(X, nRows, nFeatures);
  const binned = applyBinner(binner, X, nRows);
  const model = fitForest(params, binner, binned, nRows, nFeatures, y, "logistic");

  const sealedYear = HOLDOUT_YEARS[0]!;
  const evalMatches = loadSeason(sealedYear, { breakSeal: true });

  let scored = 0;
  let ties = 0;
  let correct = 0;
  let decided = 0;
  let brierSum = 0;
  let qualsCorrect = 0;
  let qualsDecided = 0;
  let elimsCorrect = 0;
  let elimsDecided = 0;
  let offseasonCorrect = 0;
  let offseasonDecided = 0;
  let offseasonScored = 0;
  let offseasonBrierSum = 0;

  for (const match of evalMatches) {
    if (match.redTeams.length === 0 || match.blueTeams.length === 0) continue;
    const features = extractFeatures(state, match);
    if (isEligible(match)) {
      const px = sigmoid(predictForest(model, features));
      const pNeg = sigmoid(predictForest(model, negateFeatures(features)));
      const pRedWin = (px + (1 - pNeg)) / 2;
      const actualRed = match.winner === "red" ? 1 : 0;
      scored += 1;
      brierSum += (pRedWin - actualRed) ** 2;
      const isElim = match.compLevel !== "qm";
      const isOffseason = match.eventType === 99 || match.eventType === 100;

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
        if (isOffseason) {
          offseasonDecided += 1;
          if (gotIt) offseasonCorrect += 1;
        }
      }
      if (isOffseason) {
        offseasonScored += 1;
        offseasonBrierSum += (pRedWin - actualRed) ** 2;
      }
    } else if (match.winner === "tie") {
      ties += 1;
    }
    updateStates(state, match, featureParams);
  }

  const lines: string[] = [];
  lines.push(`GBR holdout result — frozen params @ ${head}`);
  lines.push(`training years: ${DESIGN_YEARS.join(", ")}`);
  lines.push(`holdout year: ${sealedYear}`);
  lines.push(`scored=${scored} ties=${ties}`);
  lines.push(`winnerAccuracy=${decided > 0 ? (correct / decided).toFixed(4) : "n/a"}`);
  lines.push(`brier=${scored > 0 ? (brierSum / scored).toFixed(4) : "n/a"}`);
  lines.push(`qualsAccuracy=${qualsDecided > 0 ? (qualsCorrect / qualsDecided).toFixed(4) : "n/a"} (n=${qualsDecided})`);
  lines.push(`elimsAccuracy=${elimsDecided > 0 ? (elimsCorrect / elimsDecided).toFixed(4) : "n/a"} (n=${elimsDecided})`);
  lines.push(
    `offseasonAccuracy=${offseasonDecided > 0 ? (offseasonCorrect / offseasonDecided).toFixed(4) : "n/a"} ` +
      `(n=${offseasonDecided}, brier=${offseasonScored > 0 ? (offseasonBrierSum / offseasonScored).toFixed(4) : "n/a"})`,
  );

  const report = lines.join("\n") + "\n";
  writeFileSync("packages/gbr/HOLDOUT-RESULT.txt", report);
  console.log(report);
}

main();
