/**
 * Walk-forward evaluation. The model is stepped through every match in global
 * chronological order and always predicts strictly before it updates. Scoring
 * is restricted to `scoreYears`, but the state is warmed by every prior season,
 * which is what makes a holdout season a genuine out-of-sample test rather than
 * a cold start.
 */
import type { BprMatch } from "./data.js";
import { BprModel, type BprParams } from "./model.js";

export interface Stats {
  n: number;
  ties: number;
  /** Correct calls, ties excluded from both numerator and denominator. */
  correct: number;
  decided: number;
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

const empty = (): Stats => ({ n: 0, ties: 0, correct: 0, decided: 0, brier: 0, logLoss: 0 });

function accumulate(s: Stats, pRed: number, outcome: number): void {
  s.n += 1;
  if (outcome === 0.5) {
    s.ties += 1;
  } else {
    s.decided += 1;
    if (pRed > 0.5 && outcome === 1) s.correct += 1;
    else if (pRed < 0.5 && outcome === 0) s.correct += 1;
    else if (pRed === 0.5) s.correct += 0.5;
  }
  s.brier += (pRed - outcome) ** 2;
  s.logLoss += -(outcome * Math.log(pRed) + (1 - outcome) * Math.log(1 - pRed));
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

    const pred = model.predict(m.redTeams, m.blueTeams, m.year);
    const outcome = m.winner === "red" ? 1 : m.winner === "blue" ? 0 : 0.5;

    const scored =
      opts.scoreYears.has(m.year) && (opts.qualsOnly !== true || m.compLevel === "qm");
    if (scored) {
      let y = perYear.get(m.year);
      if (y === undefined) {
        y = empty();
        perYear.set(m.year, y);
      }
      accumulate(y, pred.pRed, outcome);
      accumulate(overall, pred.pRed, outcome);
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
      m.compLevel !== "qm",
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
  lines.push("  year      n   acc%    brier   logloss");
  for (const y of [...r.perYear.keys()].sort((a, b) => a - b)) {
    const s = r.perYear.get(y);
    if (s === undefined) continue;
    const acc = s.decided > 0 ? (100 * s.correct) / s.decided : 0;
    lines.push(
      `  ${y}  ${String(s.n).padStart(6)}  ${acc.toFixed(2).padStart(6)}  ` +
        `${(s.brier / s.n).toFixed(4)}  ${(s.logLoss / s.n).toFixed(4)}`,
    );
  }
  lines.push(
    `  TOTAL ${String(r.overall.n).padStart(6)}  ${(100 * r.accuracy).toFixed(2).padStart(6)}  ` +
      `${r.brier.toFixed(4)}  ${r.logLoss.toFixed(4)}`,
  );
  return lines.join("\n");
}
