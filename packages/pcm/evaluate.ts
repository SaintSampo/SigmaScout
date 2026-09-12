/**
 * PAIRED walk-forward evaluation: BPR baseline vs PCM, in ONE pass.
 *
 * Both arms are stepped through the same match list, in the same order, and
 * both always predict strictly before they update. Running them together rather
 * than in two separate passes is what makes the comparison PAIRED: every scored
 * match yields one `(pBaseline, pPcm, winner)` triple, so the difference between
 * the arms can be resampled directly instead of two independently-resampled
 * accuracies being subtracted (which would badly overstate the uncertainty --
 * the arms agree on the large majority of matches, and a paired resample keeps
 * that agreement rather than resampling it away).
 *
 * SCORING CONVENTION IS NOT DEFINED HERE. Winner accuracy comes from
 * `packages/core/scoring/brier.ts`'s `accuracyCall`, the same predicate the
 * shared harness scores OPR/EPA/BPR by, so these numbers are directly
 * comparable to every published figure in the project. In particular a
 * `pRed === 0.5` no-call is a MISS, counted in the denominator and never the
 * numerator, and reported separately.
 *
 * The D-07 surrogate rule is the shared harness's: a surrogate-affected match
 * leaves the SCOREBOARD but never the state stream. It is still predicted and
 * still updated on by both arms, so excluding it cannot change any downstream
 * prediction in either.
 *
 * `pcm.test.ts` pins the baseline arm produced by THIS loop against
 * `packages/spr/evaluate.ts`'s sealed `runEval` on the same years. That test is
 * the only thing standing between this file and a silently divergent baseline,
 * which would make every comparison it prints meaningless.
 */
import { accuracyCall, outcomeTarget } from "../core/scoring/brier.js";
import { isSurrogateAffected } from "../spr/data.js";
import { BprModel, DEFAULTS as BPR_DEFAULTS, type BprParams } from "../spr/model.js";
import { eventBlockedBootstrap } from "../harness/eventBootstrap.js";
import { PcmModel, PCM_DEFAULTS, type PcmParams } from "./model.js";
import type { PcmMatch } from "./data.js";

export interface Stats {
  n: number;
  ties: number;
  /** Correct calls. Ties are excluded from numerator and denominator (D-Q3). */
  correct: number;
  decided: number;
  /** Predictions of exactly 0.5 -- in the denominator, never the numerator. */
  noCall: number;
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

function accumulate(s: Stats, pRed: number, winner: PcmMatch["winner"]): void {
  s.n += 1;
  const target = outcomeTarget(winner);
  if (winner === "tie") s.ties += 1;
  if (pRed === 0.5) s.noCall += 1;

  const call = accuracyCall({ pRedWin: pRed, actualWinner: winner });
  if (call !== null) {
    s.decided += 1;
    if (call) s.correct += 1;
  }

  s.brier += (pRed - target) ** 2;
  s.logLoss += -(target * Math.log(pRed) + (1 - target) * Math.log(1 - pRed));
}

export interface ArmResult {
  perYear: Map<number, Stats>;
  overall: Stats;
  accuracy: number;
  brier: number;
  logLoss: number;
}

function finish(perYear: Map<number, Stats>, overall: Stats): ArmResult {
  return {
    perYear,
    overall,
    accuracy: overall.decided > 0 ? overall.correct / overall.decided : 0,
    brier: overall.n > 0 ? overall.brier / overall.n : 0,
    logLoss: overall.n > 0 ? overall.logLoss / overall.n : 0,
  };
}

/** One scored match, both arms. The unit a paired bootstrap resamples. */
export interface PairedRow {
  readonly eventKey: string;
  readonly matchKey: string;
  readonly year: number;
  readonly winner: PcmMatch["winner"];
  readonly pBase: number;
  readonly pPcm: number;
  /** Which PCM path produced `pPcm`, so fallback coverage stays attributable. */
  readonly source: "component" | "total" | "noCall";
}

export interface PairedResult {
  readonly baseline: ArmResult;
  readonly pcm: ArmResult;
  readonly rows: PairedRow[];
  /** Scored matches on which PCM actually used its component path. */
  readonly componentScored: number;
  /** Live per-phase point scales at the end of the replay, for reporting. */
  readonly phaseScales: Readonly<Record<string, number>>;
}

export interface RunOptions {
  /** Only score matches in these years. State is built from ALL prior matches. */
  readonly scoreYears: ReadonlySet<number>;
  /** Stop stepping entirely once past this year -- keeps a holdout truly sealed. */
  readonly stopAfterYear?: number;
  readonly qualsOnly?: boolean;
}

export function runPaired(
  matches: readonly PcmMatch[],
  opts: RunOptions,
  pcmParams: PcmParams = PCM_DEFAULTS,
  bprParams: BprParams = BPR_DEFAULTS,
): PairedResult {
  const baseModel = new BprModel(bprParams);
  const pcmModel = new PcmModel(pcmParams, bprParams);

  const basePerYear = new Map<number, Stats>();
  const baseOverall = empty();
  const pcmPerYear = new Map<number, Stats>();
  const pcmOverall = empty();
  const rows: PairedRow[] = [];
  let componentScored = 0;

  for (const m of matches) {
    if (opts.stopAfterYear !== undefined && m.year > opts.stopAfterYear) break;

    const isElim = m.compLevel !== "qm";
    const basePred = baseModel.predict(m.redTeams, m.blueTeams, m.year, isElim);
    const pcmPred = pcmModel.predict(m.redTeams, m.blueTeams, m.year, isElim);
    const outcome = m.winner === "red" ? 1 : m.winner === "blue" ? 0 : 0.5;

    const scored =
      opts.scoreYears.has(m.year) &&
      (opts.qualsOnly !== true || m.compLevel === "qm") &&
      !isSurrogateAffected(m);

    if (scored) {
      let by = basePerYear.get(m.year);
      if (by === undefined) {
        by = empty();
        basePerYear.set(m.year, by);
      }
      let py = pcmPerYear.get(m.year);
      if (py === undefined) {
        py = empty();
        pcmPerYear.set(m.year, py);
      }
      accumulate(by, basePred.pRed, m.winner);
      accumulate(baseOverall, basePred.pRed, m.winner);
      accumulate(py, pcmPred.pRed, m.winner);
      accumulate(pcmOverall, pcmPred.pRed, m.winner);
      if (pcmPred.source === "component") componentScored += 1;
      rows.push({
        eventKey: m.eventKey,
        matchKey: m.matchKey,
        year: m.year,
        winner: m.winner,
        pBase: basePred.pRed,
        pPcm: pcmPred.pRed,
        source: pcmPred.source,
      });
    }

    baseModel.update(
      m.redTeams,
      m.blueTeams,
      m.year,
      m.redOut,
      m.blueOut,
      m.redFoul,
      m.blueFoul,
      outcome,
      isElim,
      basePred,
    );
    pcmModel.update(
      m.redTeams,
      m.blueTeams,
      m.year,
      m.redOut,
      m.blueOut,
      m.redFoul,
      m.blueFoul,
      outcome,
      isElim,
      pcmPred,
      m.redPhase,
      m.bluePhase,
    );
  }

  return {
    baseline: finish(basePerYear, baseOverall),
    pcm: finish(pcmPerYear, pcmOverall),
    rows,
    componentScored,
    phaseScales: pcmModel.scales(),
  };
}

// --- paired significance ------------------------------------------------

function accuracyOf(rows: readonly PairedRow[], pick: (r: PairedRow) => number): number {
  let correct = 0;
  let decided = 0;
  for (const r of rows) {
    const call = accuracyCall({ pRedWin: pick(r), actualWinner: r.winner });
    if (call === null) continue;
    decided += 1;
    if (call) correct += 1;
  }
  return decided > 0 ? correct / decided : 0;
}

function brierOf(rows: readonly PairedRow[], pick: (r: PairedRow) => number): number {
  if (rows.length === 0) return 0;
  let sum = 0;
  for (const r of rows) sum += (pick(r) - outcomeTarget(r.winner)) ** 2;
  return sum / rows.length;
}

export interface PairedDelta {
  /** PCM minus baseline. Positive accuracy delta and NEGATIVE Brier delta are wins. */
  readonly accuracyDelta: number;
  readonly accuracySe: number;
  readonly accuracyCi: { lower: number; upper: number };
  readonly brierDelta: number;
  readonly brierSe: number;
  readonly brierCi: { lower: number; upper: number };
  readonly eventCount: number;
  readonly matchCount: number;
}

/**
 * Event-blocked PAIRED bootstrap on the DIFFERENCE between the arms.
 *
 * Blocked on event rather than on match because matches within one event share
 * an alliance pool and a field, so they are not independent draws -- the shared
 * harness's own resampler makes the same choice, and reusing it here keeps this
 * comparison on the project's established uncertainty convention instead of a
 * fourth hand-rolled one.
 */
export function pairedDelta(rows: readonly PairedRow[]): PairedDelta {
  const acc = eventBlockedBootstrap(rows, (sample) =>
    accuracyOf(sample, (r) => r.pPcm) - accuracyOf(sample, (r) => r.pBase),
  );
  const brier = eventBlockedBootstrap(rows, (sample) =>
    brierOf(sample, (r) => r.pPcm) - brierOf(sample, (r) => r.pBase),
  );
  return {
    accuracyDelta: acc.pointEstimate,
    accuracySe: acc.standardError,
    accuracyCi: { lower: acc.percentile.lower, upper: acc.percentile.upper },
    brierDelta: brier.pointEstimate,
    brierSe: brier.standardError,
    brierCi: { lower: brier.percentile.lower, upper: brier.percentile.upper },
    eventCount: acc.eventCount,
    matchCount: acc.matchCount,
  };
}

// --- reporting ----------------------------------------------------------

function armLines(r: ArmResult, label: string): string[] {
  const lines: string[] = [`${label}`];
  lines.push("  year      n  accDen   ties  noCall   acc%    brier   logloss");
  for (const y of [...r.perYear.keys()].sort((a, b) => a - b)) {
    const s = r.perYear.get(y);
    if (s === undefined) continue;
    const a = s.decided > 0 ? (100 * s.correct) / s.decided : 0;
    lines.push(
      `  ${y}  ${String(s.n).padStart(6)}  ${String(s.decided).padStart(6)}  ` +
        `${String(s.ties).padStart(5)}  ${String(s.noCall).padStart(6)}  ` +
        `${a.toFixed(2).padStart(6)}  ${(s.brier / s.n).toFixed(4)}  ` +
        `${(s.logLoss / s.n).toFixed(4)}`,
    );
  }
  lines.push(
    `  TOTAL ${String(r.overall.n).padStart(6)}  ${String(r.overall.decided).padStart(6)}  ` +
      `${String(r.overall.ties).padStart(5)}  ${String(r.overall.noCall).padStart(6)}  ` +
      `${(100 * r.accuracy).toFixed(2).padStart(6)}  ${r.brier.toFixed(4)}  ` +
      `${r.logLoss.toFixed(4)}`,
  );
  return lines;
}

/**
 * The verdict line uses the project's Rule A: a candidate ships only when
 * accuracy AND Brier BOTH improve. Anything else -- including a large accuracy
 * gain paired with a Brier regression -- reads as KEEP INCUMBENT. The rule is
 * applied to the point estimates and the interval is printed beside it, so a
 * reader can see whether a win is also distinguishable from zero.
 */
export function formatPaired(res: PairedResult, delta: PairedDelta, label: string): string {
  const lines: string[] = [`=== ${label} ===`, ""];
  lines.push(...armLines(res.baseline, "BPR baseline (packages/spr/model.ts DEFAULTS)"));
  lines.push("");
  lines.push(...armLines(res.pcm, "PCM (phase-component sum)"));
  lines.push("");

  const scoredN = res.rows.length;
  const pct = scoredN > 0 ? (100 * res.componentScored) / scoredN : 0;
  lines.push(
    `  component path used on ${res.componentScored}/${scoredN} scored matches (${pct.toFixed(1)}%); ` +
      `the remainder fell back to the private BPR instance and are IDENTICAL to the baseline by construction`,
  );
  const scales = Object.entries(res.phaseScales)
    .map(([k, v]) => `${k}=${v.toFixed(1)}`)
    .join("  ");
  lines.push(`  final phase point scales: ${scales}`);
  lines.push("");

  const accWin = delta.accuracyDelta > 0;
  const brierWin = delta.brierDelta < 0;
  lines.push(
    `  PAIRED delta (PCM - baseline), event-blocked over ${delta.eventCount} events / ${delta.matchCount} matches:`,
  );
  lines.push(
    `    accuracy  ${(100 * delta.accuracyDelta).toFixed(3)}pp  ` +
      `+/- ${(100 * delta.accuracySe).toFixed(3)}  ` +
      `[${(100 * delta.accuracyCi.lower).toFixed(3)}, ${(100 * delta.accuracyCi.upper).toFixed(3)}]  ` +
      `${accWin ? "better" : "WORSE"}`,
  );
  lines.push(
    `    brier     ${delta.brierDelta >= 0 ? "+" : ""}${delta.brierDelta.toFixed(5)}  ` +
      `+/- ${delta.brierSe.toFixed(5)}  ` +
      `[${delta.brierCi.lower.toFixed(5)}, ${delta.brierCi.upper.toFixed(5)}]  ` +
      `${brierWin ? "better" : "WORSE"}`,
  );
  lines.push("");
  lines.push(
    `  RULE A: ${accWin && brierWin ? "PCM improves BOTH -- the idea is worth pursuing" : "KEEP INCUMBENT (BPR) -- Rule A not met"}`,
  );
  return lines.join("\n");
}
