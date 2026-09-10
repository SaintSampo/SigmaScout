/**
 * Does the production port reproduce the research model?
 *
 * `packages/core/algorithms/bpr.ts` is a rewrite of `packages/bpr/model.ts`
 * against the project's pure `AlgorithmModule` contract. A rewrite that quietly
 * drifted would mean the published algorithm is not the one that scored on the
 * sealed holdout, and nobody would notice. This walks the same corpus through
 * the ported module and prints its accuracy next to the frozen research
 * numbers.
 *
 * DESIGN ERA BY DEFAULT. This file used to print a 2023-2026 figure on every
 * invocation, which made an ordinary port check a holdout read — the replay now
 * HALTS at the end of 2022 unless `--include-holdout` is passed explicitly, so
 * a later season is not merely unprinted but never stepped.
 *
 * One deliberate difference is expected. The research model ages a team into a
 * new season LAZILY, on that team's first match; the contract calls
 * `carrySeason` eagerly for every team at the boundary. With seasonShrink = 1.0
 * the mean is untouched either way, so the only divergence is that a team which
 * skips a season accumulates `seasonVar` once per boundary rather than once in
 * total - worth a few thousandths of a variance unit.
 */
import { bpr, type BprState } from "../core/algorithms/bpr.js";
import type { CompLevel, MatchResult } from "../core/algorithms/types.js";
import { accuracyCall } from "../core/scoring/brier.js";
import { isSurrogateAffected, loadMatches } from "./data.js";

/**
 * The research model's design-era accuracy under the SHARED measurement path
 * (`accuracyCall`'s D-Q3 convention, the shared population, D-07 surrogate
 * exclusion). Was 73.081 before quick task 260909-03b: that pre-P3 value came
 * from a retired local convention that awarded half credit for an
 * unopinionated prediction and scored a population no other algorithm saw. The
 * honest number is lower; the drop is the correction, not a regression.
 *
 * Both frozen figures below PREDATE quick task 260910-4bf's scoring-target
 * change (dropping TBA's `adjustPoints`). A small nonzero design-era delta
 * against the port is therefore expected now and is evidence of the target
 * change, not of port drift.
 */
const KNOWN_DESIGN = 72.87;
const KNOWN_HOLDOUT_ALL = 78.05;
const LAST_DESIGN_YEAR = 2022;

function main(): void {
  const includeHoldout = process.argv.includes("--include-holdout");
  const matches = loadMatches("data/corpus.sqlite");
  let state: BprState = bpr.initState([]);
  let season = -1;

  const per = new Map<number, [number, number]>();

  for (const m of matches) {
    if (!includeHoldout && m.year > LAST_DESIGN_YEAR) break;
    if (season !== -1 && m.year !== season) {
      state = bpr.carrySeason?.(state, {
        fromSeason: season,
        toSeason: m.year,
        isColdStart: false,
      }) ?? state;
    }
    season = m.year;

    // Round-trips through the port's own correctionsOf parser rather than
    // reusing the already-extracted values, so the parser is under test too.
    // Carries adjustPoints alongside foulPoints (quick task 260910-4bf) so
    // the round-trip exercises both fields the port now reads.
    const scoreBreakdownRaw = JSON.stringify({
      red: { foulPoints: m.redFoul, adjustPoints: m.redAdjust },
      blue: { foulPoints: m.blueFoul, adjustPoints: m.blueAdjust },
    });

    const result: MatchResult = {
      matchKey: m.matchKey,
      eventKey: m.eventKey,
      compLevel: m.compLevel as CompLevel,
      setNumber: 1,
      matchNumber: 1,
      redTeams: m.redTeams,
      blueTeams: m.blueTeams,
      redSurrogates: m.redSurrogates,
      blueSurrogates: m.blueSurrogates,
      eventType: m.eventType,
      winner: m.winner,
      redScore: m.redOut + m.redFoul + m.redAdjust,
      blueScore: m.blueOut + m.blueFoul + m.blueAdjust,
      redRpEarned: null,
      blueRpEarned: null,
      redDqs: m.redDqs,
      blueDqs: m.blueDqs,
      hasScoreBreakdown: true,
      scoreBreakdownRaw,
    };

    const p = bpr.predict(state, result);
    // Same predicate and same D-07 exclusion `evaluate.ts` scores by, so the
    // port and the research model are compared on ONE convention. The retired
    // inline `(p.pRedWin > 0.5) === (m.winner === "red")` credited an
    // unopinionated 0.5 prediction whenever blue happened to win.
    if (!isSurrogateAffected(m)) {
      const call = accuracyCall({ pRedWin: p.pRedWin, actualWinner: m.winner });
      if (call !== null) {
        const cell = per.get(m.year) ?? [0, 0];
        per.set(m.year, [cell[0] + (call ? 1 : 0), cell[1] + 1]);
      }
    }
    state = bpr.update(state, result);
  }

  const agg = (years: number[]): number => {
    let c = 0;
    let n = 0;
    for (const y of years) {
      const cell = per.get(y);
      if (!cell) continue;
      c += cell[0];
      n += cell[1];
    }
    return n > 0 ? (100 * c) / n : 0;
  };

  console.log("Ported module (packages/core/algorithms/bpr.ts) vs frozen research model");
  console.log(`  scope: ${includeHoldout ? "2016-2026 (HOLDOUT INCLUDED)" : "design era only, halted after 2022"}`);
  console.log("  year      acc%");
  for (const y of [...per.keys()].sort((a, b) => a - b)) {
    const cell = per.get(y);
    if (!cell) continue;
    console.log(`  ${y}   ${((100 * cell[0]) / cell[1]).toFixed(3).padStart(7)}`);
  }
  const design = agg([2016, 2017, 2018, 2019, 2020, 2022]);
  console.log("");
  console.log(
    `  design 2016-2022  port ${design.toFixed(3)}  research ${KNOWN_DESIGN.toFixed(3)}  ` +
      `delta ${(design - KNOWN_DESIGN >= 0 ? "+" : "") + (design - KNOWN_DESIGN).toFixed(3)}pp`,
  );
  if (includeHoldout) {
    const holdout = agg([2023, 2024, 2025, 2026]);
    console.log(
      `  holdout 2023-2026 port ${holdout.toFixed(3)}  research ${KNOWN_HOLDOUT_ALL.toFixed(2)}   ` +
        `delta ${(holdout - KNOWN_HOLDOUT_ALL >= 0 ? "+" : "") + (holdout - KNOWN_HOLDOUT_ALL).toFixed(3)}pp` +
        `  (research figure predates the shared measurement path - not comparable)`,
    );
  }
}

main();
