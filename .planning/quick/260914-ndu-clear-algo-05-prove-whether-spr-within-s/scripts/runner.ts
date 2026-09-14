/**
 * Walk-forward replay of the SPR research model, a line-for-line mirror of
 * `packages/spr/evaluate.ts`'s `runEval` loop (predict, score, then update)
 * with one addition: `scaleReset`, which zeroes the online scale's counter at
 * each season's first match. With `scaleMinLr: 0` that turns the recency
 * EWMA into a plain within-season running mean, the fair static counterpart
 * to scale adaptation.
 *
 * `runner-equivalence` in design-grid.ts checks that this loop reproduces
 * `runEval` exactly before any arm is scored with it.
 */
import { readFileSync } from "node:fs";
import { accuracyCall, outcomeTarget } from "../../../../packages/core/scoring/brier.js";
import { matches } from "../../../../packages/spr/cli.js";
import { isSurrogateAffected, type BprMatch } from "../../../../packages/spr/data.js";
import { BprModel, DEFAULTS, type BprParams } from "../../../../packages/spr/model.js";

export interface ArmParams extends BprParams {
  scaleReset?: boolean;
}

export interface Scored {
  readonly eventKey: string;
  readonly matchKey: string;
  readonly year: number;
  readonly compLevel: string;
  readonly winner: BprMatch["winner"];
  readonly pRed: number;
}

export function frozenParams(): BprParams {
  const raw = JSON.parse(readFileSync("packages/spr/frozen-params.json", "utf8")) as { params: Partial<BprParams> };
  return { ...DEFAULTS, ...raw.params };
}

export function replay(p: ArmParams, scoreYears: ReadonlySet<number>, stopAfterYear: number): Scored[] {
  const model = new BprModel(p);
  const out: Scored[] = [];
  let lastYear = -1;
  for (const m of matches()) {
    if (m.year > stopAfterYear) break;
    if (p.scaleReset === true && m.year !== lastYear) {
      // Private at compile time only; tsx does not typecheck.
      (model as unknown as { scaleCount: number }).scaleCount = 0;
    }
    lastYear = m.year;
    const isElim = m.compLevel !== "qm";
    const pred = model.predict(m.redTeams, m.blueTeams, m.year, isElim);
    if (scoreYears.has(m.year) && !isSurrogateAffected(m)) {
      out.push({ eventKey: m.eventKey, matchKey: m.matchKey, year: m.year, compLevel: m.compLevel, winner: m.winner, pRed: pred.pRed });
    }
    const outcome = m.winner === "red" ? 1 : m.winner === "blue" ? 0 : 0.5;
    model.update(m.redTeams, m.blueTeams, m.year, m.redOut, m.blueOut, m.redFoul, m.blueFoul, outcome, isElim, pred);
  }
  return out;
}

export function summarize(rows: readonly Scored[]): { n: number; acc: number; brier: number; logLoss: number } {
  let decided = 0;
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  for (const r of rows) {
    const t = outcomeTarget(r.winner);
    const call = accuracyCall({ pRedWin: r.pRed, actualWinner: r.winner });
    if (call !== null) {
      decided += 1;
      if (call) correct += 1;
    }
    brier += (r.pRed - t) ** 2;
    logLoss += -(t * Math.log(r.pRed) + (1 - t) * Math.log(1 - r.pRed));
  }
  return { n: rows.length, acc: decided > 0 ? correct / decided : 0, brier: brier / rows.length, logLoss: logLoss / rows.length };
}
