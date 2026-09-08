/**
 * BPR driver. Default action: walk-forward evaluation over the DESIGN years
 * only (2016-2022). The 2023-2026 holdout is deliberately not reachable
 * without an explicit --holdout flag, so it cannot be scored by accident
 * during design iteration.
 */
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

export function evalDesign(params: BprParams, qualsOnly = false) {
  return runEval(matches(), params, {
    scoreYears: DESIGN_YEARS,
    qualsOnly,
    stopAfterYear: LAST_DESIGN_YEAR,
  });
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

main();
