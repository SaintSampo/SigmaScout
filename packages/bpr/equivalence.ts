/**
 * Does the production port reproduce the research model?
 *
 * `packages/core/algorithms/bpr.ts` is a rewrite of `packages/bpr/model.ts`
 * against the project's pure `AlgorithmModule` contract. A rewrite that quietly
 * drifted would mean the published algorithm is not the one that scored 78.05%
 * on the sealed holdout, and nobody would notice. This walks the same corpus
 * through the ported module and prints its accuracy next to the frozen
 * research numbers.
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
import { loadMatches } from "./data.js";

const KNOWN_DESIGN = 73.081;
const KNOWN_HOLDOUT_ALL = 78.05;

function main(): void {
  const matches = loadMatches("data/corpus.sqlite");
  let state: BprState = bpr.initState([]);
  let season = -1;

  const per = new Map<number, [number, number]>();

  for (const m of matches) {
    if (season !== -1 && m.year !== season) {
      state = bpr.carrySeason?.(state, {
        fromSeason: season,
        toSeason: m.year,
        isColdStart: false,
      }) ?? state;
    }
    season = m.year;

    // Round-trips through the port's own foulPoints parser rather than reusing
    // the already-extracted value, so the parser is under test too.
    const scoreBreakdownRaw = JSON.stringify({
      red: { foulPoints: m.redFoul },
      blue: { foulPoints: m.blueFoul },
    });

    const result: MatchResult = {
      matchKey: m.matchKey,
      eventKey: m.eventKey,
      compLevel: m.compLevel as CompLevel,
      setNumber: 1,
      matchNumber: 1,
      redTeams: m.redTeams,
      blueTeams: m.blueTeams,
      redSurrogates: [],
      blueSurrogates: [],
      eventType: 0,
      winner: m.winner,
      redScore: m.redOut + m.redFoul,
      blueScore: m.blueOut + m.blueFoul,
      redRpEarned: null,
      blueRpEarned: null,
      redDqs: [],
      blueDqs: [],
      hasScoreBreakdown: true,
      scoreBreakdownRaw,
    };

    const p = bpr.predict(state, result);
    if (m.winner !== "tie") {
      const right = (p.pRedWin > 0.5) === (m.winner === "red") ? 1 : 0;
      const cell = per.get(m.year) ?? [0, 0];
      per.set(m.year, [cell[0] + right, cell[1] + 1]);
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
  console.log("  year      acc%");
  for (const y of [...per.keys()].sort((a, b) => a - b)) {
    const cell = per.get(y);
    if (!cell) continue;
    console.log(`  ${y}   ${((100 * cell[0]) / cell[1]).toFixed(3).padStart(7)}`);
  }
  const design = agg([2016, 2017, 2018, 2019, 2020, 2022]);
  const holdout = agg([2023, 2024, 2025, 2026]);
  console.log("");
  console.log(
    `  design 2016-2022  port ${design.toFixed(3)}  research ${KNOWN_DESIGN.toFixed(3)}  ` +
      `delta ${(design - KNOWN_DESIGN >= 0 ? "+" : "") + (design - KNOWN_DESIGN).toFixed(3)}pp`,
  );
  console.log(
    `  holdout 2023-2026 port ${holdout.toFixed(3)}  research ${KNOWN_HOLDOUT_ALL.toFixed(2)}   ` +
      `delta ${(holdout - KNOWN_HOLDOUT_ALL >= 0 ? "+" : "") + (holdout - KNOWN_HOLDOUT_ALL).toFixed(3)}pp`,
  );
}

main();
