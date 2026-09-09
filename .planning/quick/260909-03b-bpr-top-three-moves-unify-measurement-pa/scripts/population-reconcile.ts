/**
 * Does BPR now load the SAME population the shared harness scores?
 *
 * Part (a) is a pure COUNT — it runs no model, forms no prediction, and reads
 * no accuracy. It compares `loadMatches`'s per-season population against the
 * recount table `260908-vqr-REVIEW.md` Angle A produced from one shared harness
 * run over `opr,epa,vpr,bpr`. Counting rows is a property of the corpus, not a
 * measurement of a model, so it is safe on every season.
 *
 * Part (b) evaluates the model, and is therefore DESIGN-ERA ONLY: `runEval` is
 * called with `stopAfterYear: 2022`, so the replay halts at the end of 2022 and
 * a later season is never stepped at all.
 */
import { readFileSync } from "node:fs";
import { evalDesign, DESIGN_YEARS, matches } from "../../../../packages/bpr/cli.js";
import { isSurrogateAffected, loadDiagnostics } from "../../../../packages/bpr/data.js";
import { DEFAULTS, type BprParams } from "../../../../packages/bpr/model.js";

/**
 * `260908-vqr-REVIEW.md` Angle A, "Winner accuracy, combined view, identical
 * denominators" — the `n / accDen / ties` column, transcribed verbatim.
 */
const REVIEW_RECOUNT: Record<number, { n: number; accDen: number; ties: number }> = {
  2016: { n: 13263, accDen: 13117, ties: 146 },
  2017: { n: 15364, accDen: 15103, ties: 261 },
  2018: { n: 16889, accDen: 16861, ties: 28 },
  2019: { n: 17972, accDen: 17664, ties: 308 },
  2020: { n: 4644, accDen: 4618, ties: 26 },
  2022: { n: 14603, accDen: 14427, ties: 176 },
  2023: { n: 16290, accDen: 16144, ties: 146 },
  2024: { n: 16958, accDen: 16764, ties: 194 },
  2025: { n: 17815, accDen: 17692, ties: 123 },
  2026: { n: 18337, accDen: 18292, ties: 45 },
};

const DESIGN_TOTAL_DEN = 81790;

function main(): void {
  console.log("BPR population reconciliation vs 260908-vqr-REVIEW.md Angle A");
  console.log("");

  // ---- Part (a): counts only. No model, no prediction, no accuracy. ----
  const all = matches();
  const counts = new Map<number, { n: number; ties: number }>();
  for (const m of all) {
    if (isSurrogateAffected(m)) continue; // D-07, the harness's own exclusion
    const c = counts.get(m.year) ?? { n: 0, ties: 0 };
    c.n += 1;
    if (m.winner === "tie") c.ties += 1;
    counts.set(m.year, c);
  }

  console.log("(a) loaded population per season - counts only, no model involved");
  console.log("  year   loaded_n  review_n   d_n  loaded_den  review_den  d_den  loaded_ties  review_ties  d_ties");
  let mismatches = 0;
  for (const year of Object.keys(REVIEW_RECOUNT).map(Number).sort((a, b) => a - b)) {
    const want = REVIEW_RECOUNT[year]!;
    const got = counts.get(year) ?? { n: 0, ties: 0 };
    const gotDen = got.n - got.ties;
    const dN = got.n - want.n;
    const dDen = gotDen - want.accDen;
    const dTies = got.ties - want.ties;
    if (dN !== 0 || dDen !== 0 || dTies !== 0) mismatches += 1;
    console.log(
      `  ${year}  ${String(got.n).padStart(9)} ${String(want.n).padStart(9)} ` +
        `${(dN >= 0 ? "+" : "") + dN}`.padStart(6) +
        `  ${String(gotDen).padStart(10)}  ${String(want.accDen).padStart(10)} ` +
        `${(dDen >= 0 ? "+" : "") + dDen}`.padStart(7) +
        `  ${String(got.ties).padStart(11)}  ${String(want.ties).padStart(11)} ` +
        `${(dTies >= 0 ? "+" : "") + dTies}`.padStart(8),
    );
  }
  console.log("");
  console.log(`  PER-SEASON MISMATCHES: ${mismatches} (target: 0, across all ten seasons)`);

  const designDen = [...DESIGN_YEARS]
    .map((y) => {
      const c = counts.get(y) ?? { n: 0, ties: 0 };
      return c.n - c.ties;
    })
    .reduce((a, b) => a + b, 0);
  console.log(
    `  design-era denominator: ${designDen} vs review ${DESIGN_TOTAL_DEN} ` +
      `(delta ${designDen - DESIGN_TOTAL_DEN})`,
  );

  const diag = loadDiagnostics();
  console.log(
    `  rows with a winner but a null score (counted, never filtered): ${diag.nullScoreWithWinner} (expected 0)`,
  );
  console.log("");

  // ---- Part (b): model evaluation, DESIGN ERA ONLY. ----
  // evalDesign -> evalYears(params, DESIGN_YEARS, LAST_DESIGN_YEAR) passes
  // stopAfterYear: 2022, so the replay halts at the end of 2022.
  console.log("(b) design-era evaluation on the frozen parameters, halted after 2022");
  const frozen = JSON.parse(
    readFileSync("packages/bpr/frozen-params.json", "utf8"),
  ) as { params?: BprParams };
  const params: BprParams = { ...DEFAULTS, ...(frozen.params ?? (frozen as unknown as BprParams)) };
  const r = evalDesign(params);
  console.log(`  accuracy: ${(100 * r.accuracy).toFixed(3)}%`);
  console.log(`  brier:    ${r.brier.toFixed(5)}`);
  console.log(`  logloss:  ${r.logLoss.toFixed(5)}`);
  console.log(`  scored n: ${r.overall.n}   accDen: ${r.overall.decided}   ties: ${r.overall.ties}   noCall: ${r.overall.noCall}`);
  console.log("");
  console.log(`  pre-P3 value under the retired convention: 73.081%`);
  console.log(`  review's shared-harness figure:            72.87%`);
}

main();
