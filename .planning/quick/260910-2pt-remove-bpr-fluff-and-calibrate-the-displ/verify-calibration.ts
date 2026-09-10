/**
 * Verify the display calibration against the SHIPPED port, not the research model.
 *
 * Two questions, both answered by one design-era replay of
 * `packages/core/algorithms/bpr.ts`:
 *
 *   1. PREDICTION NEUTRALITY. Hash every pRedWin the port emits. This hash must
 *      be BIT-IDENTICAL before and after the change, which is what makes the
 *      sealed 78.05% still a statement about this module.
 *
 *   2. INTERVAL HONESTY. Form z from the port's own emitted `redScore` and
 *      `redScoreVarianceOwn` — i.e. exactly the numbers that get published and
 *      rendered — and check sd(z) lands on 1.0 overall and across strength.
 *
 * DESIGN ERA ONLY (year <= 2022).
 */
import { createHash } from "node:crypto";
import { bpr, type BprState } from "../../../packages/core/algorithms/bpr.js";
import type { CompLevel, MatchResult } from "../../../packages/core/algorithms/types.js";
import { loadMatches } from "../../../packages/bpr/data.js";

const LAST_DESIGN_YEAR = 2022;
let state: BprState = bpr.initState([]);
let season = -1;

const hash = createHash("sha256");
const recs: Array<{ z: number; pts: number; year: number }> = [];
const seasonOut = new Map<number, [number, number]>();
let nPred = 0;

for (const m of loadMatches("data/corpus.sqlite")) {
  if (m.year > LAST_DESIGN_YEAR) break;
  if (season !== -1 && m.year !== season) {
    state = bpr.carrySeason?.(state, { fromSeason: season, toSeason: m.year, isColdStart: false }) ?? state;
  }
  season = m.year;

  const result: MatchResult = {
    matchKey: m.matchKey, eventKey: m.eventKey, compLevel: m.compLevel as CompLevel,
    setNumber: 1, matchNumber: 1,
    redTeams: m.redTeams, blueTeams: m.blueTeams,
    redSurrogates: m.redSurrogates, blueSurrogates: m.blueSurrogates,
    eventType: m.eventType, winner: m.winner,
    redScore: m.redOut + m.redFoul, blueScore: m.blueOut + m.blueFoul,
    redRpEarned: null, blueRpEarned: null,
    redDqs: m.redDqs, blueDqs: m.blueDqs,
    hasScoreBreakdown: true,
    scoreBreakdownRaw: JSON.stringify({ red: { foulPoints: m.redFoul }, blue: { foulPoints: m.blueFoul } }),
  };

  const p = bpr.predict(state, result);

  // (1) prediction-neutrality fingerprint: pRedWin at full precision, in order.
  hash.update(`${m.matchKey}:${p.pRedWin.toExponential(17)}|`);
  nPred += 1;

  // (2) interval honesty, from the EMITTED display fields only.
  const sides = [
    [m.redOut, p.redScore, p.redScoreVarianceOwn],
    [m.blueOut, p.blueScore, p.blueScoreVarianceOwn],
  ] as const;
  for (const [obs, mu, varOwn] of sides) {
    if (varOwn !== undefined && varOwn > 0) {
      recs.push({ z: (obs - mu) / Math.sqrt(varOwn), pts: mu, year: m.year });
    }
  }
  const cell = seasonOut.get(m.year) ?? [0, 0];
  seasonOut.set(m.year, [cell[0] + m.redOut + m.blueOut, cell[1] + 2]);

  state = bpr.update(state, result);
}

const sd = (v: number[]): number => {
  const mu = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / v.length);
};

console.log(`Port replay, design era 2016-${LAST_DESIGN_YEAR}`);
console.log(`  matches predicted:        ${nPred}`);
console.log(`  PREDICTION FINGERPRINT:   ${hash.digest("hex")}`);
console.log(`     (sha256 over every pRedWin, full precision, in match order)\n`);

console.log(`  alliance-observations:    ${recs.length}`);
console.log(`  sd(z) from EMITTED redScoreVarianceOwn: ${sd(recs.map((r) => r.z)).toFixed(4)}   (1.000 = honest)`);

// Bin by season-relative strength so the quintiles mean the same thing across
// seasons with different point scales. Diagnostic proxy only.
const rel = recs.map((r) => {
  const c = seasonOut.get(r.year)!;
  return { z: r.z, s: r.pts / (c[0] / c[1]) };
}).sort((a, b) => a.s - b.s);
const q = Math.floor(rel.length / 5);
console.log("\n  sd(z) by season-relative alliance strength");
for (let i = 0; i < 5; i += 1) {
  const c = rel.slice(i * q, i === 4 ? rel.length : (i + 1) * q);
  console.log(`    Q${i + 1}  n=${String(c.length).padStart(6)}  mean rel ${(c.reduce((a, r) => a + r.s, 0) / c.length).toFixed(3)}   sd(z) ${sd(c.map((r) => r.z)).toFixed(4)}`);
}
