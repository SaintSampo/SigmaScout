/**
 * BPR driver. Default action: walk-forward evaluation over the DESIGN years
 * only (2016-2022). The 2023-2026 holdout is deliberately not reachable
 * without an explicit --holdout flag, so it cannot be scored by accident
 * during design iteration.
 */
import { pathToFileURL } from "node:url";
import { loadMatches, type BprMatch } from "./data.js";
import { runEval, formatResult } from "./evaluate.js";
import { DEFAULTS, type BprParams } from "./model.js";

export const DESIGN_YEARS = new Set([2016, 2017, 2018, 2019, 2020, 2022]);
export const HOLDOUT_YEARS = new Set([2023, 2024, 2025, 2026]);
export const LAST_DESIGN_YEAR = 2022;

const CORPUS = "data/corpus.sqlite";

let cached: BprMatch[] | null = null;
export function matches(): BprMatch[] {
  if (cached === null) {
    const t = Date.now();
    cached = loadMatches(CORPUS);
    process.stderr.write(`[bpr] loaded ${cached.length} matches in ${Date.now() - t}ms\n`);
  }
  return cached;
}

/**
 * Evaluate over an arbitrary subset of the design years. Used to hold a slice
 * of the design era out of tuning so the optimism of the search can be measured
 * without spending any of the real 2023-2026 holdout.
 */
export interface EvalExtra {
  qualsOnly?: boolean;
  useRawScore?: boolean;
  /**
   * Per-SCORED-match hook, forwarded to `runEval`. Lets an ablation or a
   * candidate comparison emit per-match predictions for a PAIRED bootstrap
   * without every caller reimplementing the replay loop. Observational only:
   * it is called after the prediction and before the update, and cannot
   * influence either.
   */
  onScored?: (m: BprMatch, pRed: number) => void;
}

export function evalYears(
  params: BprParams,
  scoreYears: ReadonlySet<number>,
  stopAfterYear: number,
  extra: EvalExtra = {},
) {
  return runEval(matches(), params, { scoreYears, stopAfterYear, ...extra });
}

export function evalDesign(params: BprParams, extra: EvalExtra = {}) {
  return evalYears(params, DESIGN_YEARS, LAST_DESIGN_YEAR, extra);
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes("--holdout")) {
    throw new Error(
      "Holdout evaluation is not run from cli.ts. Use packages/bpr/holdout.ts, " +
        "which requires a committed frozen parameter file.",
    );
  }
  const r = evalDesign(DEFAULTS);
  console.log(formatResult(r, "BPR defaults - DESIGN years (2016-2022)"));
}

// Only run when invoked directly. tune.ts / ablate.ts / holdout.ts import this
// module for evalDesign() and the year sets, and an unguarded main() would make
// every one of them silently burn an extra full evaluation on import.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main();
}
