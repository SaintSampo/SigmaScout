/**
 * Walk-forward evaluation. The model is stepped through every match in global
 * chronological order and always predicts strictly before it updates. Scoring
 * is restricted to `scoreYears`, but the state is warmed by every prior season,
 * which is what makes a holdout season a genuine out-of-sample test rather than
 * a cold start.
 *
 * Scoring convention is NOT defined here. Winner accuracy comes from
 * `packages/core/scoring/brier.ts`'s `accuracyCall`, the same predicate the
 * shared harness scores OPR/EPA/VPR by, so a BPR accuracy is directly
 * comparable to every historical number in the project. The retired local rule
 * awarded HALF CREDIT for an unopinionated `pRed === 0.5` prediction against a
 * decided match; D-Q3 counts it a miss and reports the abstention separately
 * (`noCall`). That change LOWERS BPR's design-era figure — from 73.081 to the
 * honest value — and adopting it is the point, not a regression.
 */
import { accuracyCall, outcomeTarget } from "../core/scoring/brier.js";
import { isSurrogateAffected, type BprMatch } from "./data.js";
import { BprModel, type BprParams } from "./model.js";

export interface Stats {
  n: number;
  ties: number;
  /** Correct calls. Ties are excluded from numerator and denominator (D-Q3). */
  correct: number;
  decided: number;
  /**
   * Predictions of exactly 0.5. IN the accuracy denominator and never in the
   * numerator, reported so the abstention rate stays visible separately from
   * the miss rate.
   */
  noCall: number;
  brier: number;
  logLoss: number;
}

export interface EvalResult {
  perYear: Map<number, Stats>;
  overall: Stats;
  /** Accuracy over decided (non-tie) matches. */
  accuracy: number;
  brier: number;
  logLoss: number;
}

const empty = (): Stats => ({
  n: 0,
  ties: 0,
  correct: 0,
  decided: 0,
  noCall: 0,
  brier: 0,
  logLoss: 0,
});

function accumulate(s: Stats, pRed: number, winner: BprMatch["winner"]): void {
  s.n += 1;
  const target = outcomeTarget(winner);
  if (winner === "tie") s.ties += 1;
  if (pRed === 0.5) s.noCall += 1;

  // One shared predicate — `null` is exactly the excluded (tied) case, and a
  // 0.5 no-call returns `false` rather than half credit.
  const call = accuracyCall({ pRedWin: pRed, actualWinner: winner });
  if (call !== null) {
    s.decided += 1;
    if (call) s.correct += 1;
  }

  s.brier += (pRed - target) ** 2;
  s.logLoss += -(target * Math.log(pRed) + (1 - target) * Math.log(1 - pRed));
}

export interface RunOptions {
  /** Only score matches in these years. State is built from all matches. */
  scoreYears: ReadonlySet<number>;
  /** Restrict scoring to qualification matches only. */
  qualsOnly?: boolean;
  /** Stop stepping entirely once past this year (keeps a holdout truly sealed). */
  stopAfterYear?: number;
  /** Feed the model unadjusted alliance scores instead of foul-adjusted ones. */
  useRawScore?: boolean;
  /**
   * Called for every SCORED match, after the prediction and before the update.
   * Used to emit per-match jsonl for a paired bootstrap without giving every
   * caller its own copy of the replay loop.
   */
  onScored?: (m: BprMatch, pRed: number) => void;
}

export function runEval(
  matches: readonly BprMatch[],
  params: BprParams,
  opts: RunOptions,
): EvalResult {
  const model = new BprModel(params);
  const perYear = new Map<number, Stats>();
  const overall = empty();

  for (const m of matches) {
    if (opts.stopAfterYear !== undefined && m.year > opts.stopAfterYear) break;

    const isElim = m.compLevel !== "qm";
    const pred = model.predict(m.redTeams, m.blueTeams, m.year, isElim);
    const outcome = m.winner === "red" ? 1 : m.winner === "blue" ? 0 : 0.5;

    // D-07: a surrogate-affected match leaves the SCOREBOARD but never the
    // state stream — it is still predicted and still updated on, exactly as
    // the shared harness replays it, so excluding it cannot change any
    // downstream prediction.
    const scored =
      opts.scoreYears.has(m.year) &&
      (opts.qualsOnly !== true || m.compLevel === "qm") &&
      !isSurrogateAffected(m);
    if (scored) {
      let y = perYear.get(m.year);
      if (y === undefined) {
        y = empty();
        perYear.set(m.year, y);
      }
      accumulate(y, pred.pRed, m.winner);
      accumulate(overall, pred.pRed, m.winner);
      opts.onScored?.(m, pred.pRed);
    }

    model.update(
      m.redTeams,
      m.blueTeams,
      m.year,
      opts.useRawScore === true ? m.redRaw : m.redOut,
      opts.useRawScore === true ? m.blueRaw : m.blueOut,
      m.redFoul,
      m.blueFoul,
      outcome,
      isElim,
      pred,
    );
  }

  return {
    perYear,
    overall,
    accuracy: overall.decided > 0 ? overall.correct / overall.decided : 0,
    brier: overall.n > 0 ? overall.brier / overall.n : 0,
    logLoss: overall.n > 0 ? overall.logLoss / overall.n : 0,
  };
}

export function formatResult(r: EvalResult, label: string): string {
  const lines: string[] = [`${label}`];
  lines.push("  year      n  accDen   ties  noCall   acc%    brier   logloss");
  for (const y of [...r.perYear.keys()].sort((a, b) => a - b)) {
    const s = r.perYear.get(y);
    if (s === undefined) continue;
    const acc = s.decided > 0 ? (100 * s.correct) / s.decided : 0;
    lines.push(
      `  ${y}  ${String(s.n).padStart(6)}  ${String(s.decided).padStart(6)}  ` +
        `${String(s.ties).padStart(5)}  ${String(s.noCall).padStart(6)}  ` +
        `${acc.toFixed(2).padStart(6)}  ${(s.brier / s.n).toFixed(4)}  ` +
        `${(s.logLoss / s.n).toFixed(4)}`,
    );
  }
  lines.push(
    `  TOTAL ${String(r.overall.n).padStart(6)}  ${String(r.overall.decided).padStart(6)}  ` +
      `${String(r.overall.ties).padStart(5)}  ${String(r.overall.noCall).padStart(6)}  ` +
      `${(100 * r.accuracy).toFixed(2).padStart(6)}  ${r.brier.toFixed(4)}  ` +
      `${r.logLoss.toFixed(4)}`,
  );
  return lines.join("\n");
}
