import type { MatchRecord } from "../core/types";

/** Fraction of played matches whose pre-match prediction called the winner.
 *  Ties and unplayed matches are excluded. */
export function predictionAccuracy(matches: MatchRecord[]): {
  correct: number;
  total: number;
  pct: number;
} {
  let correct = 0;
  let total = 0;
  for (const m of matches) {
    if (!m.played || m.redActual === undefined || m.blueActual === undefined) continue;
    if (m.redActual === m.blueActual) continue; // tie — no winner to call
    const predictedRed = m.prediction.redWinProb > 0.5;
    const actualRed = m.redActual > m.blueActual;
    if (predictedRed === actualRed) correct++;
    total++;
  }
  return { correct, total, pct: total ? (correct / total) * 100 : 0 };
}
