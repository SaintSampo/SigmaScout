/**
 * Hyperparameter search for BPR, scored EXCLUSIVELY on the design years
 * (2016-2022). This file must never import HOLDOUT_YEARS.
 *
 * Objective: winner accuracy first, log loss as tiebreak when the accuracy gap
 * is inside noise. With ~83k design matches the standard error on accuracy is
 * about 0.17pp, so gaps below ~0.05pp are treated as ties rather than wins.
 */
import { readFileSync } from "node:fs";
import { evalDesign, evalYears, LAST_DESIGN_YEAR } from "./cli.js";
import { DEFAULTS, type BprParams } from "./model.js";

const ACC_NOISE = 0.0005;

interface Scored {
  acc: number;
  logLoss: number;
  brier: number;
}

/**
 * BPR_TUNE_YEARS restricts the search to a subset of the design era, e.g.
 * "2016,2017,2018,2019" to leave 2020+2022 as an internal validation slice.
 * Unset means the whole design era. It can never name a holdout year: anything
 * past LAST_DESIGN_YEAR is rejected rather than silently clipped.
 */
const TUNE_YEARS: ReadonlySet<number> | null = (() => {
  const raw = process.env.BPR_TUNE_YEARS;
  if (raw === undefined || raw.trim() === "") return null;
  const years = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  for (const y of years) {
    if (y > LAST_DESIGN_YEAR) {
      throw new Error(`tune: ${y} is a holdout year - tuning may never score it`);
    }
  }
  return new Set(years);
})();

function score(params: BprParams): Scored {
  const r =
    TUNE_YEARS === null
      ? evalDesign(params)
      : evalYears(params, TUNE_YEARS, Math.max(...TUNE_YEARS));
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
  { key: "obsSd", values: [0.4, 0.55, 0.7, 0.85, 1.0, 1.2, 1.5] },
  { key: "qSlow", values: [0.00002, 0.00005, 0.0002, 0.0008, 0.003] },
  { key: "rhoFast", values: [0.5, 0.75, 0.9, 0.96, 0.99] },
  { key: "qFast", values: [0.002, 0.006, 0.015, 0.03, 0.06] },
  { key: "priorVar", values: [0.02, 0.05, 0.1, 0.25, 0.6] },
  { key: "fastPriorVar", values: [0.02, 0.06, 0.12, 0.25, 0.5] },
  { key: "rookieMean", values: [0.25, 0.4, 0.55, 0.7, 0.85] },
  { key: "seasonShrink", values: [0.7, 0.85, 0.95, 1.0] },
  { key: "seasonVar", values: [0.01, 0.03, 0.05, 0.12, 0.3] },
  { key: "tauLr", values: [0.0, 0.002, 0.005, 0.015, 0.04] },
  { key: "foulObsSd", values: [0.3, 0.5, 0.8, 1.5, 3.0] },
  { key: "foulQ", values: [0.0001, 0.0005, 0.002, 0.006] },
  { key: "foulPriorVar", values: [0.005, 0.02, 0.08, 0.2] },
  { key: "elimWeight", values: [0.0, 0.1, 0.2, 0.3, 0.5, 0.8] },
  { key: "scaleMinLr", values: [0.002, 0.01, 0.03, 0.08] },
  { key: "w2", values: [0.6, 0.7, 0.85, 1.0, 1.15] },
  { key: "w3", values: [0.2, 0.35, 0.5, 0.6, 0.75, 1.0] },
  { key: "defPriorVar", values: [0, 0.005, 0.02, 0.06, 0.15] },
  { key: "defQ", values: [0, 0.0002, 0.001, 0.004] },
  { key: "huberK", values: [1e9, 4, 3, 2.5, 2, 1.5, 1.2] },
  { key: "biasLr", values: [0, 0.001, 0.004, 0.015, 0.05] },
  { key: "obsSdSlope", values: [0, 0.1, 0.2, 0.35, 0.5, 0.7, 1.0] },
];

/**
 * BPR_SKIP_KEYS removes knobs from the search entirely, so the parsimonious
 * model can be re-tuned with its dropped components genuinely absent rather
 * than merely disabled at settings chosen for a richer configuration.
 */
const SKIP = new Set(
  (process.env.BPR_SKIP_KEYS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== ""),
);

export function coordinateDescent(start: BprParams, sweeps: number): BprParams {
  let best = { ...start };
  let bestScore = score(best);
  process.stderr.write(
    `[tune] start acc=${(100 * bestScore.acc).toFixed(3)} ll=${bestScore.logLoss.toFixed(4)}\n`,
  );

  for (let sweep = 1; sweep <= sweeps; sweep += 1) {
    let improvedThisSweep = false;
    for (const { key, values } of GRID) {
      if (SKIP.has(key)) continue;
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
  const seedPath = process.env.BPR_SEED;
  let start: BprParams = DEFAULTS;
  if (seedPath !== undefined && seedPath !== "") {
    const raw = JSON.parse(readFileSync(seedPath, "utf8")) as { params?: BprParams };
    start = { ...DEFAULTS, ...(raw.params ?? (raw as unknown as BprParams)) };
    process.stderr.write(`[tune] seeded from ${seedPath}\n`);
  }
  const best = coordinateDescent(start, sweeps);
  const s = score(best);
  console.log(JSON.stringify({ params: best, design: s }, null, 2));
}

main();
