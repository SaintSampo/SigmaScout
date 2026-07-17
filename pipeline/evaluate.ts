// Walk-forward (prequential) evaluation: stream matches in time order, PREDICT
// each one from the current model state, score the prediction, THEN fold the
// match in. Every prediction is genuinely out-of-sample — the only honest way to
// tell whether a faster learning rate actually helps.
//
//   npm run eval -- 2016
//
// Sweeps the learning-rate multiplier alpha (process noise Q = alpha * R). alpha
// = 0 is a static online OPR (never adapts); alpha > 0 lets each team's skill
// drift. We report log-loss / Brier / accuracy so we can see the optimum.

import { fetchSeasonMatches, componentsFor } from "./fetch";
import type { ObservedMatch } from "./fetch";
import { KalmanModel, type KalmanConfig } from "./kalman";
import { estimatePriors } from "./priors";
import { probAGreaterThanB } from "../src/core/stats";
import type { ComponentId, Season } from "../src/core/types";

try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {
  /* rely on real env */
}

interface Metrics {
  logLoss: number;
  brier: number;
  accuracy: number;
  scoreRmse: number;
  n: number;
}

const EPS = 1e-6;
const clamp = (p: number) => Math.min(1 - EPS, Math.max(EPS, p));

function evaluate(matches: ObservedMatch[], cfg: KalmanConfig): Metrics {
  const model = new KalmanModel(cfg);
  let ll = 0,
    brier = 0,
    correct = 0,
    sse = 0,
    n = 0;

  for (const m of matches) {
    if (m.redTeams.length !== 3 || m.blueTeams.length !== 3) continue;
    model.advanceMatch(m); // time-update to this match before predicting
    const red = model.predictAlliance(m.redTeams);
    const blue = model.predictAlliance(m.blueTeams);

    // Winner label uses OFFICIAL scores (incl. fouls) — the real outcome.
    // Score-RMSE compares the model's earned-score prediction to the earned
    // (foul-excluded) actual, since fouls aren't modelled.
    const redEarned = cfg.components.reduce((s, c) => s + (m.redByComponent[c] ?? 0), 0);
    const blueEarned = cfg.components.reduce((s, c) => s + (m.blueByComponent[c] ?? 0), 0);

    if (m.redScore !== m.blueScore) {
      const p = clamp(probAGreaterThanB(red.mean, red.variance, blue.mean, blue.variance));
      const y = m.redScore > m.blueScore ? 1 : 0;
      ll += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
      brier += (p - y) * (p - y);
      if ((p > 0.5 ? 1 : 0) === y) correct++;
      sse += (red.mean - redEarned) ** 2 + (blue.mean - blueEarned) ** 2;
      n++;
    }
    model.observeMatch(m); // fold the match in after scoring
  }

  return {
    logLoss: ll / n,
    brier: brier / n,
    accuracy: correct / n,
    scoreRmse: Math.sqrt(sse / (2 * n)),
    n,
  };
}

async function main() {
  const season = (Number(process.argv[2]) || 2016) as Season;
  const components = componentsFor(season);
  console.log(`Loading ${season} matches…`);
  const matches = await fetchSeasonMatches(season);
  console.log(`Estimating priors / measurement noise via ridge OPR…`);
  const priors = estimatePriors(matches, components);
  console.log(
    "  R (σ) per component:",
    Object.fromEntries(
      components.map((c) => [c, Math.sqrt(priors.measurementNoise[c]).toFixed(1)]),
    ),
  );

  const buildCfg = (alpha: number, kappa: number): KalmanConfig => {
    const processNoise: Record<ComponentId, number> = {};
    for (const c of components) processNoise[c] = alpha * priors.measurementNoise[c];
    return {
      components,
      priorMean: priors.priorMean,
      priorVariance: priors.priorVariance,
      measurementNoise: priors.measurementNoise,
      processNoise,
      eventGapInflation: 3.0,
      adaptStrength: kappa,
      adaptDecay: 0.7,
    };
  };

  const row = (label: string, m: Metrics, flag: string) =>
    console.log(
      `  ${label}   ${m.logLoss.toFixed(4)}   ${m.brier.toFixed(3)}   ` +
        `${(m.accuracy * 100).toFixed(1)}   ${m.scoreRmse.toFixed(1)}${flag}`,
    );

  // --- Sweep 1: fixed learning rate alpha (adaptive gain off) ---
  console.log(`\n  Walk-forward over ${matches.length} matches (${season}):\n`);
  console.log("  [1] fixed learning rate (kappa=0)");
  console.log("  alpha   logLoss   brier   acc%    scoreRMSE");
  console.log("  " + "-".repeat(46));
  let bestAlpha = { alpha: 0, logLoss: Infinity };
  for (const alpha of [0, 0.005, 0.01, 0.02, 0.04, 0.08, 0.16]) {
    const m = evaluate(matches, buildCfg(alpha, 0));
    const better = m.logLoss < bestAlpha.logLoss;
    if (better) bestAlpha = { alpha, logLoss: m.logLoss };
    row(alpha.toFixed(3), m, better ? " *" : "");
  }

  // --- Sweep 2: adaptive gain kappa, at the best fixed alpha ---
  console.log(`\n  [2] adaptive per-team gain, at alpha=${bestAlpha.alpha}`);
  console.log("  kappa   logLoss   brier   acc%    scoreRMSE");
  console.log("  " + "-".repeat(46));
  let bestKappa = { kappa: 0, logLoss: Infinity };
  for (const kappa of [0, 0.5, 1, 2, 4, 8]) {
    const m = evaluate(matches, buildCfg(bestAlpha.alpha, kappa));
    const better = m.logLoss < bestKappa.logLoss;
    if (better) bestKappa = { kappa, logLoss: m.logLoss };
    row(kappa.toFixed(1), m, better ? " *" : "");
  }

  // --- Sweep 3: joint — can targeted fast-learning (low base alpha + adaptive
  //     boost) beat blanket fast-learning? This is the fair test of adaptation. ---
  console.log(`\n  [3] joint: low base alpha + adaptive gain`);
  console.log("  alpha  kappa   logLoss   scoreRMSE");
  console.log("  " + "-".repeat(40));
  for (const alpha of [0, 0.005]) {
    for (const kappa of [2, 8, 16, 32]) {
      const m = evaluate(matches, buildCfg(alpha, kappa));
      const better = m.logLoss < bestKappa.logLoss;
      if (better) bestKappa = { kappa, logLoss: m.logLoss };
      console.log(
        `  ${alpha.toFixed(3)}  ${kappa.toFixed(0).padStart(2)}     ` +
          `${m.logLoss.toFixed(4)}   ${m.scoreRmse.toFixed(1)}${better ? " *" : ""}`,
      );
    }
  }

  console.log("  " + "-".repeat(46));
  console.log(`  naive 50/50 baseline logLoss = ${Math.log(2).toFixed(4)}`);
  console.log(
    `\n  Best: alpha=${bestAlpha.alpha}, kappa=${bestKappa.kappa} ` +
      `(logLoss ${bestKappa.logLoss.toFixed(4)}).`,
  );
  const gain = bestAlpha.logLoss - bestKappa.logLoss;
  console.log(
    gain > 1e-4
      ? `  Adaptive gain helped: ${bestAlpha.logLoss.toFixed(4)} -> ${bestKappa.logLoss.toFixed(4)}.`
      : `  Adaptive gain did NOT beat fixed-rate here (kappa=0 optimal).`,
  );
}

main().catch((e) => {
  console.error("\nEval failed:\n" + (e?.message ?? e));
  process.exit(1);
});
