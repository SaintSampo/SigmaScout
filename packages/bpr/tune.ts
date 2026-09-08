/**
 * Hyperparameter search for BPR, scored EXCLUSIVELY on the design years
 * (2016-2022). This file must never import HOLDOUT_YEARS.
 *
 * Objective: winner accuracy first, log loss as tiebreak when the accuracy gap
 * is inside noise. With ~83k design matches the standard error on accuracy is
 * about 0.17pp, so gaps below ~0.05pp are treated as ties rather than wins.
 */
import { evalDesign } from "./cli.js";
import { DEFAULTS, type BprParams } from "./model.js";

const ACC_NOISE = 0.0005;

interface Scored {
  acc: number;
  logLoss: number;
  brier: number;
}

function score(params: BprParams): Scored {
  const r = evalDesign(params);
  return { acc: r.accuracy, logLoss: r.logLoss, brier: r.brier };
}

/** True when `a` is a genuine improvement over `b`. */
function better(a: Scored, b: Scored): boolean {
  if (a.acc - b.acc > ACC_NOISE) return true;
  if (b.acc - a.acc > ACC_NOISE) return false;
  return a.logLoss < b.logLoss;
}

type NumericKey = {
  [K in keyof BprParams]: BprParams[K] extends number ? K : never;
}[keyof BprParams];

const GRID: Array<{ key: NumericKey; values: number[] }> = [
  { key: "obsSd", values: [0.25, 0.35, 0.45, 0.6, 0.8, 1.0] },
  { key: "qSlow", values: [0.0002, 0.0005, 0.001, 0.002, 0.004, 0.008] },
  { key: "rhoFast", values: [0.0, 0.5, 0.75, 0.9, 0.97] },
  { key: "qFast", values: [0.0, 0.002, 0.006, 0.015, 0.04] },
  { key: "priorVar", values: [0.1, 0.25, 0.5, 1.0, 2.0] },
  { key: "fastPriorVar", values: [0.0, 0.02, 0.05, 0.12, 0.3] },
  { key: "rookieMean", values: [0.4, 0.55, 0.7, 0.85, 1.0] },
  { key: "seasonShrink", values: [0.3, 0.5, 0.7, 0.85, 1.0] },
  { key: "seasonVar", values: [0.05, 0.15, 0.3, 0.6, 1.2] },
  { key: "tauLr", values: [0.0, 0.005, 0.02, 0.05, 0.12] },
  { key: "foulObsSd", values: [0.15, 0.25, 0.35, 0.5, 0.8] },
  { key: "foulQ", values: [0.0005, 0.002, 0.006, 0.015] },
  { key: "foulPriorVar", values: [0.02, 0.08, 0.15, 0.4] },
  { key: "elimWeight", values: [0.3, 0.6, 1.0, 1.5, 2.5] },
  { key: "scaleMinLr", values: [0.002, 0.01, 0.03, 0.08] },
];

export function coordinateDescent(start: BprParams, sweeps: number): BprParams {
  let best = { ...start };
  let bestScore = score(best);
  process.stderr.write(
    `[tune] start acc=${(100 * bestScore.acc).toFixed(3)} ll=${bestScore.logLoss.toFixed(4)}\n`,
  );

  for (let sweep = 1; sweep <= sweeps; sweep += 1) {
    let improvedThisSweep = false;
    for (const { key, values } of GRID) {
      const current = best[key];
      for (const v of values) {
        if (v === current) continue;
        const trial = { ...best, [key]: v };
        const s = score(trial);
        if (better(s, bestScore)) {
          best = trial;
          bestScore = s;
          improvedThisSweep = true;
          process.stderr.write(
            `[tune] sweep${sweep} ${key}=${v} -> acc=${(100 * s.acc).toFixed(3)} ` +
              `ll=${s.logLoss.toFixed(4)}\n`,
          );
        }
      }
    }
    if (!improvedThisSweep) {
      process.stderr.write(`[tune] converged after sweep ${sweep}\n`);
      break;
    }
  }
  return best;
}

function main(): void {
  const sweeps = Number(process.env.BPR_SWEEPS ?? "3");
  const best = coordinateDescent(DEFAULTS, sweeps);
  const s = score(best);
  console.log(JSON.stringify({ params: best, design: s }, null, 2));
}

main();
