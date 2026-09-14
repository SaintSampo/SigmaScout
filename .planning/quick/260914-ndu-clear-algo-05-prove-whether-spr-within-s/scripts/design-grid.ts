/**
 * DESIGN ERA ONLY (2016-2022). Picks the fair adaptation-off counterparts
 * before any 2023-2026 number is computed, so each off arm is the best static
 * model the design years support rather than a strawman.
 *
 * Accuracy does not depend on tau (tau > 0 never changes the sign of z, and
 * the rating update never reads tau), so structural knobs are picked on
 * accuracy (Brier breaks ties) and tau0 afterwards on Brier.
 *
 * Run from the repo root: npx tsx <this file>
 */
import { writeFileSync } from "node:fs";
import { evalDesign, DESIGN_YEARS, LAST_DESIGN_YEAR } from "../../../../packages/spr/cli.js";
import type { BprParams } from "../../../../packages/spr/model.js";
import { frozenParams, replay, summarize, type ArmParams } from "./runner.js";

const DIR = ".planning/quick/260914-ndu-clear-algo-05-prove-whether-spr-within-s";
const frozen = frozenParams();

const log: string[] = [];
const say = (s: string): void => {
  console.log(s);
  log.push(s);
};

const score = (p: ArmParams) => summarize(replay(p, DESIGN_YEARS, LAST_DESIGN_YEAR));

// ---- runner-equivalence: the local loop must reproduce runEval exactly ----
const ref = evalDesign(frozen);
const mine = score(frozen);
const refPrior = evalDesign({ ...frozen, tauLr: 0, qFast: 0 });
const minePrior = score({ ...frozen, tauLr: 0, qFast: 0 });
if (ref.accuracy !== mine.acc || ref.brier !== mine.brier || refPrior.brier !== minePrior.brier) {
  throw new Error(`runner-equivalence FAILED: runEval ${ref.accuracy}/${ref.brier} vs local ${mine.acc}/${mine.brier}`);
}
say(`runner-equivalence PASSED (bit-identical accuracy and Brier on two parameter sets)`);
say(`ON (frozen)  acc ${(100 * mine.acc).toFixed(3)}  brier ${mine.brier.toFixed(5)}  n ${mine.n}`);

const TAUS = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0, 1.2];
const Q_SLOW = [0, 0.00002, 0.0001, 0.0003, 0.001, 0.002, 0.005, 0.01, 0.02];
const SEASON_VAR = [0.03, 0.1, 0.28, 0.5, 1, 2];
const PRIOR_VAR = [0.05, 0.1, 0.35, 0.7, 1.5];

function edge<T>(grid: readonly T[], v: T): string {
  return v === grid[0] || v === grid[grid.length - 1] ? " (GRID EDGE)" : "";
}

function pickTau(base: ArmParams, label: string): number {
  let best = { tau: NaN, brier: Infinity };
  for (const tau0 of TAUS) {
    const s = score({ ...base, tauLr: 0, tau0 });
    say(`  ${label} tau0=${tau0}  acc ${(100 * s.acc).toFixed(3)}  brier ${s.brier.toFixed(5)}`);
    if (s.brier < best.brier) best = { tau: tau0, brier: s.brier };
  }
  say(`  -> ${label} static tau0 = ${best.tau}${edge(TAUS, best.tau)} (design Brier ${best.brier.toFixed(5)})`);
  return best.tau;
}

function pickSingleTimescale(base: ArmParams, label: string): Partial<BprParams> {
  let best = { qSlow: NaN, seasonVar: NaN, priorVar: NaN, acc: -1, brier: Infinity };
  for (const qSlow of Q_SLOW)
    for (const seasonVar of SEASON_VAR)
      for (const priorVar of PRIOR_VAR) {
        const s = score({ ...base, qSlow, seasonVar, priorVar });
        say(`  ${label} qSlow=${qSlow} seasonVar=${seasonVar} priorVar=${priorVar}  acc ${(100 * s.acc).toFixed(3)}  brier ${s.brier.toFixed(5)}`);
        if (s.acc > best.acc || (s.acc === best.acc && s.brier < best.brier)) best = { qSlow, seasonVar, priorVar, ...s };
      }
  say(
    `  -> ${label} qSlow=${best.qSlow}${edge(Q_SLOW, best.qSlow)} seasonVar=${best.seasonVar}${edge(SEASON_VAR, best.seasonVar)} ` +
      `priorVar=${best.priorVar}${edge(PRIOR_VAR, best.priorVar)} (design acc ${(100 * best.acc).toFixed(3)})`,
  );
  return { qSlow: best.qSlow, seasonVar: best.seasonVar, priorVar: best.priorVar };
}

const noFast = { qFast: 0, fastPriorVar: 0 };
const seasonMeanScale = { scaleMinLr: 0, scaleReset: true };

say("\n[tau] static link temperature, everything else as frozen");
const tauFair = pickTau(frozen, "tau");

say("\n[fast] single timescale; scale and tau adaptation left on");
const fastFair = pickSingleTimescale({ ...frozen, ...noFast }, "fast");

say("\n[all] single timescale + within-season mean scale + static tau");
const allStruct = pickSingleTimescale({ ...frozen, ...noFast, ...seasonMeanScale, tauLr: 0 }, "all");
const allTau = pickTau({ ...frozen, ...noFast, ...seasonMeanScale, ...allStruct }, "all");

const arms: Record<string, Partial<ArmParams>> = {
  "off-tau-naive": { tauLr: 0 },
  "off-tau-fair": { tauLr: 0, tau0: tauFair },
  "off-scale-naive": { scaleMinLr: 0 },
  "off-scale-fair": { ...seasonMeanScale },
  "off-fast-naive": { ...noFast },
  "off-fast-fair": { ...noFast, ...fastFair },
  "off-all-naive": { ...noFast, scaleMinLr: 0, tauLr: 0 },
  "off-all-fair": { ...noFast, ...seasonMeanScale, tauLr: 0, ...allStruct, tau0: allTau },
};

say("\nArms (overrides on packages/spr/frozen-params.json), design era:");
for (const [name, over] of Object.entries(arms)) {
  const params = { ...frozen, ...over };
  const s = score(params);
  say(`  ${name.padEnd(16)} acc ${(100 * s.acc).toFixed(3)}  brier ${s.brier.toFixed(5)}  ${JSON.stringify(over)}`);
  writeFileSync(`${DIR}/arms/${name}.json`, JSON.stringify({ overrides: over, params }, null, 2) + "\n");
}
writeFileSync(`${DIR}/DESIGN-GRID.txt`, log.join("\n") + "\n");
