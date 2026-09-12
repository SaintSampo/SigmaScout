/**
 * SIGMA SCORE vs SWING SCORE — the head-to-head.
 *
 * Experiment (quick task 260910-u7g). Nothing here is wired into publish.
 *
 * ---------------------------------------------------------------------------
 * HOW THE COMPARISON IS KEPT FAIR
 * ---------------------------------------------------------------------------
 *
 * 1. IDENTICAL ROWS. Every candidate is driven over the same walk-forward pass
 *    and scored on exactly the same (team, match) rows. A candidate that could
 *    choose its own row set could choose a flattering one.
 *
 * 2. IDENTICAL INPUT. Every candidate consumes the same even-split deviation
 *    `(actual - predicted) / rosterSize`. This comparison is about the
 *    ESTIMATOR, not about a better input — changing both at once would leave
 *    the result unattributable.
 *
 * 3. AN ESTIMATOR-INDEPENDENT TARGET. Each candidate supplies a LOCATION (its
 *    own bias estimate) and a SCALE, and is scored on the team's actual RAW next
 *    deviation. Scoring against a CENTRED deviation would let each candidate
 *    define the thing it is graded on — its own centring would appear in both
 *    the prediction and the target, which is not a measurement.
 *
 * 4. A PROPER SCORING RULE. Gaussian NLL of the raw deviation punishes
 *    over-confidence and under-confidence alike, and lets a constant compete.
 *    MEDIAN is reported beside the mean throughout: quick task 260910-sz9
 *    established that a log score's mean is dominated by a handful of
 *    catastrophic rows (0.06-0.35% of rows carried 83-100% of Swing's loss).
 *
 * 5. A MISMATCHED-PAIRING CONTROL, carried over from `measureSwingSkill.ts`,
 *    where it caught a 4x inflation on its first run.
 *
 * ---------------------------------------------------------------------------
 * THE TWO REQUIREMENT TESTS, WHICH OUTRANK THE SCORE
 * ---------------------------------------------------------------------------
 *
 * The developer's requirement is not "minimise NLL", it is:
 *
 *   "If a robot breaks, or finally starts working, Sigma Score captures that for
 *    a scout. VS if they have performed the same every match, Sigma Score should
 *    be low."
 *
 * So two properties are measured directly, and a candidate that wins on NLL
 * while failing these has NOT met the requirement:
 *
 *   RESPONSIVENESS  At a genuine level shift (a team's next-3-match mean
 *                   deviation differs from its prior-3 by >= 15 points), how much
 *                   does the metric RISE afterwards relative to before? Higher
 *                   is better.
 *   SEPARATION      The metric's mean on QUIET runs (trailing realized spread in
 *                   the bottom quintile) divided by its mean on VOLATILE runs
 *                   (top quintile). LOWER is better — a steady robot should read
 *                   visibly lower than an erratic one.
 *
 * Both labels are assigned with hindsight. That is legitimate here and would not
 * be in the estimator: labels exist only to define evaluation subsets, and are
 * never fed to any candidate.
 *
 * Usage:
 *   npx tsx scripts/compareSigmaScore.ts [--seasons 2024-2025] [--algorithms opr,epa,spr]
 *   pnpm compare:sigma-score
 */

import { pathToFileURL } from "node:url";
import { openCorpusReadOnly } from "../packages/corpus/db.js";
import { buildSeasonStream, toLeakProofUpcoming } from "../packages/harness/replay.js";
import { resolvePublishAlgorithms } from "../packages/harness/publish.js";
import { SigmaScoreAccumulator, type SigmaScoreOptions } from "../packages/harness/sigmaScore.js";
import {
  SwingFactorAccumulator,
  SWING_FACTOR_SCALE,
  swingDecayFor,
  SWING_FACTOR_HALF_LIFE_MATCHES,
} from "../packages/harness/swingFactor.js";
import { isFullyDemoAlliance } from "../packages/core/algorithms/demoTeams.js";
import { isFullyDqZeroScoreAlliance } from "../packages/core/algorithms/dq.js";
import { TOTAL_METRIC_KEY } from "../packages/core/algorithms/types.js";
import {
  coverage,
  gaussianNllRows,
  mean,
  median,
  pearson,
  parseSeasons,
  spearman,
  standardizeWithinGroups,
} from "./measureSwingSkill.js";

const CORPUS_PATH = "data/corpus.sqlite";
const GAUSSIAN_1SIGMA_COVERAGE = 0.683;

/**
 * A level shift this large (points of even-split deviation) counts as "broke, or
 * started working".
 *
 * KNOWN LIMITATION, stated rather than left for a reader to trip over: this is
 * an ABSOLUTE threshold, and seasons differ in scoring scale. 2026's deviations
 * are much larger than 2024's, so the same 15 points selects ~47,000 "shifts" in
 * 2026 against ~3,900 in 2024-2025 — many of the 2026 ones are ordinary noise
 * rather than a robot genuinely changing, which compresses every candidate's
 * responsiveness ratio toward 1.
 *
 * That makes the responsiveness MAGNITUDE incomparable ACROSS seasons. It does
 * NOT affect the comparison this script exists for: within a run, every
 * candidate is measured over the identical shift events on the identical rows,
 * so the RANKING between candidates is sound. Making the threshold relative to
 * each season's own deviation spread would fix the cross-season reading and is
 * the obvious next change if anyone needs it.
 */
const REGIME_SHIFT_POINTS = 15;
/** Matches either side of a candidate shift point used to establish the before and after levels. */
const REGIME_WINDOW = 3;

interface Candidate {
  readonly id: string;
  readonly note: string;
  /** `undefined` marks the incumbent, which is driven through its own accumulator. */
  readonly options?: Partial<SigmaScoreOptions>;
}

const CANDIDATES: readonly Candidate[] = [
  { id: "swing", note: "incumbent, scale 1.92, mean and var both half-life 6" },
  { id: "sigma-fast", note: "mean 6 / var 6, priorObs 4, talent prior", options: { meanHalfLife: 6 } },
  { id: "sigma-slow", note: "mean 18 / var 6, priorObs 4, talent prior", options: { meanHalfLife: 18 } },
  {
    id: "sigma-slow-flat",
    note: "mean 18 / var 6, priorObs 4, FLAT prior (talent control)",
    options: { meanHalfLife: 18, talentPrior: false },
  },
  {
    id: "sigma-slow-strong",
    note: "mean 18 / var 6, priorObs 8, talent prior",
    options: { meanHalfLife: 18, priorObs: 8 },
  },
  { id: "sigma-veryslow", note: "mean 40 / var 6, priorObs 4, talent prior", options: { meanHalfLife: 40 } },
  // Second sweep (2024-2025 tuning). The first sweep showed shrinkage buying
  // calibration and volatility-ranking at the cost of RESPONSIVENESS and
  // SEPARATION — the prior anchors a team's reading, which damps exactly the
  // "this robot just broke" move the metric exists to show. These probe the
  // weakest prior that still removes the near-zero tail, and a faster
  // volatility clock to buy responsiveness back.
  {
    id: "sigma-weak",
    note: "mean 18 / var 6, priorObs 2.5 (minimum useful shrinkage)",
    options: { meanHalfLife: 18, priorObs: 2.5 },
  },
  {
    id: "sigma-var3",
    note: "mean 18 / var 3 (fast volatility clock), priorObs 4",
    options: { meanHalfLife: 18, varHalfLife: 3 },
  },
  {
    id: "sigma-weak-var3",
    note: "mean 18 / var 3, priorObs 2.5 — weak prior AND fast clock",
    options: { meanHalfLife: 18, varHalfLife: 3, priorObs: 2.5 },
  },
  {
    id: "sigma-weak-var2",
    note: "mean 18 / var 2, priorObs 2.5 — most responsive configuration probed",
    options: { meanHalfLife: 18, varHalfLife: 2, priorObs: 2.5 },
  },
];

/** One scored row: the same (team, match) for every candidate. */
interface Row {
  readonly teamKey: string;
  readonly season: number;
  /** Chronological index of the match this row came from, for the regime test. */
  readonly matchIndex: number;
  /** The actual raw deviation — the shared target. */
  readonly dev: number;
  /** Per candidate id: the location and scale it offered BEFORE this match. */
  readonly byCandidate: ReadonlyMap<string, { location: number; scale: number }>;
}

/**
 * The incumbent wrapped to the same (location, scale) interface every Sigma
 * candidate exposes, so the scoring loop cannot accidentally treat them
 * differently.
 *
 * Its location is its own recency-weighted running mean — the same quantity its
 * centring already uses internally — reconstructed here because
 * `SwingFactorAccumulator` exposes `beliefFor`, whose `mean` field IS that
 * value. No re-implementation: the number comes from the shipped accumulator.
 *
 * Its scale is `swing / SWING_FACTOR_SCALE`, i.e. the implied 1 sigma, so that
 * it is compared on the same footing as Sigma Score's honest 1 sigma rather than
 * being penalised for its 1.92 presentation multiplier.
 */
class IncumbentCandidate {
  readonly #accumulator = new SwingFactorAccumulator();
  /** Population fallback for teams with fewer than two observations, walk-forward. */
  #fallbackSumSquares = 0;
  #fallbackCount = 0;

  locationAndScale(teamKey: string): { location: number; scale: number } {
    const belief = this.#accumulator.beliefFor(teamKey);
    const swing = this.#accumulator.swingFor(teamKey);
    const location = belief?.mean ?? 0;
    if (swing !== undefined && swing > 0) {
      return { location, scale: swing / SWING_FACTOR_SCALE };
    }
    // Swing Factor is UNDEFINED below two observations. It still has to be
    // scored on those rows or the comparison would quietly run on different row
    // sets, so it falls back to the walk-forward population RMS — the most
    // generous honest stand-in, and explicitly NOT zero.
    const fallback = this.#fallbackCount > 0 ? Math.sqrt(this.#fallbackSumSquares / this.#fallbackCount) : 1;
    return { location, scale: fallback > 0 ? fallback : 1 };
  }

  fold(roster: readonly string[], actual: number, predicted: number): void {
    if (roster.length === 0) return;
    const deviation = (actual - predicted) / roster.length;
    if (!Number.isFinite(deviation)) return;
    this.#fallbackSumSquares += deviation * deviation;
    this.#fallbackCount += 1;
    this.#accumulator.fold(roster, actual, predicted);
  }
}

/**
 * Drives every candidate over one season for one algorithm, walk-forward.
 *
 * The loop is written here rather than reusing `WalkForwardSimulator.runAll`
 * because each candidate's prior needs the team's TALENT as of BEFORE the match,
 * and `runAll`'s `onMatchComplete` only ever exposes POST-update state. The
 * leak-proof wrapper is the same one the simulator uses, imported rather than
 * re-created, so predictions here carry the identical no-peeking guarantee.
 */
function runSeason(
  algorithm: ReturnType<typeof resolvePublishAlgorithms>[number],
  season: number,
  matches: readonly Awaited<ReturnType<typeof buildSeasonStream>>[number][]
): Row[] {
  const teams = [...new Set(matches.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
  let state: unknown = algorithm.initState([...teams]);

  const incumbent = new IncumbentCandidate();
  const sigmas = new Map<string, SigmaScoreAccumulator>();
  for (const candidate of CANDIDATES) {
    if (candidate.options !== undefined) sigmas.set(candidate.id, new SigmaScoreAccumulator(candidate.options));
  }

  const rows: Row[] = [];

  for (const [matchIndex, match] of matches.entries()) {
    const prediction = algorithm.predict(state, toLeakProofUpcoming(match));

    const rosterAll = [...match.redTeams, ...match.blueTeams];
    // Talent as of BEFORE this match, read only for the teams on it.
    const metrics = algorithm.teamMetrics(state, rosterAll);
    for (const teamKey of rosterAll) {
      const talent = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
      if (talent !== undefined) {
        for (const accumulator of sigmas.values()) accumulator.observeTalent(teamKey, talent);
      }
    }

    // Same gating the shipped estimator applies, so every candidate learns from
    // and is scored on the population the incumbent was designed around.
    const demoMatch = isFullyDemoAlliance(match.redTeams) || isFullyDemoAlliance(match.blueTeams);
    if (!demoMatch) {
      const sides = [
        { teams: match.redTeams, actual: match.redScore, dqs: match.redDqs, predicted: prediction.redScore },
        { teams: match.blueTeams, actual: match.blueScore, dqs: match.blueDqs, predicted: prediction.blueScore },
      ] as const;

      for (const side of sides) {
        if (side.teams.length === 0) continue;
        if (isFullyDqZeroScoreAlliance(side.teams, side.dqs, side.actual)) continue;
        if (!Number.isFinite(side.actual) || !Number.isFinite(side.predicted)) continue;
        const dev = (side.actual - side.predicted) / side.teams.length;

        // READ every candidate BEFORE any fold — predict-before-update.
        for (const teamKey of side.teams) {
          const byCandidate = new Map<string, { location: number; scale: number }>();
          byCandidate.set("swing", incumbent.locationAndScale(teamKey));
          for (const [id, accumulator] of sigmas) {
            byCandidate.set(id, { location: accumulator.biasFor(teamKey), scale: accumulator.sigmaFor(teamKey) });
          }
          rows.push({ teamKey, season, matchIndex, dev, byCandidate });
        }

        // THEN fold.
        incumbent.fold(side.teams, side.actual, side.predicted);
        for (const accumulator of sigmas.values()) {
          for (const teamKey of side.teams) accumulator.fold(teamKey, dev);
        }
      }
    }

    state = algorithm.update(state, match);
  }

  return rows;
}

/** Scores one candidate over a row set. */
function scoreCandidate(rows: readonly Row[], candidateId: string) {
  const usable = rows.filter((r) => {
    const entry = r.byCandidate.get(candidateId);
    return entry !== undefined && entry.scale > 0 && Number.isFinite(entry.scale) && Number.isFinite(entry.location);
  });
  const devs = usable.map((r) => r.dev);
  const locations = usable.map((r) => r.byCandidate.get(candidateId)!.location);
  const scales = usable.map((r) => r.byCandidate.get(candidateId)!.scale);
  const residuals = usable.map((r, i) => r.dev - locations[i]!);

  const nllRows = gaussianNllRows(residuals, scales);
  const seasons = usable.map((r) => r.season);
  const scalesZ = standardizeWithinGroups(scales, seasons);
  const absDevZ = standardizeWithinGroups(devs.map(Math.abs), seasons);
  const stride = 10007 % Math.max(1, absDevZ.length);
  const mismatched = absDevZ.map((_, i) => absDevZ[(i + stride) % absDevZ.length]!);

  // TRIMMED mean NLL — the mean with the worst 1% of rows dropped.
  //
  // This column exists because the other two disagree and neither alone is
  // conclusive. The MEAN is the proper scoring rule (a correctly calibrated
  // Gaussian minimises it), but the incumbent's mean is destroyed by a tail of a
  // few hundred near-zero-swing rows, so it reads as a 200x rout that tells you
  // about the tail and nothing about a typical team. The MEDIAN is robust but
  // IMPROPER — it rewards over-confidence, because a too-tight sigma wins on the
  // many small-residual rows and only pays on the few large ones it has stopped
  // being measured on.
  //
  // Trimming answers the question both miss: with the catastrophes excluded, is
  // the candidate still better for an ordinary team?
  const trimmed = [...nllRows].sort((a, b) => a - b).slice(0, Math.max(1, Math.floor(nllRows.length * 0.99)));

  return {
    n: usable.length,
    meanNll: mean(nllRows),
    trimmedNll: mean(trimmed),
    medianNll: median(nllRows),
    spearman: spearman(scalesZ, absDevZ),
    control: pearson(scalesZ, mismatched),
    coverage: coverage(residuals, scales),
    meanScale: mean(scales),
  };
}

/**
 * RESPONSIVENESS — at a genuine level shift, how much does the metric rise?
 *
 * For each team, walks its own chronological deviation list. A shift at position
 * `i` is where the mean of the NEXT `REGIME_WINDOW` deviations differs from the
 * mean of the PREVIOUS `REGIME_WINDOW` by at least `REGIME_SHIFT_POINTS`. The
 * metric's mean over the following window is divided by its mean over the
 * preceding window.
 *
 * Reported as a MEDIAN across shift events, not a mean: a single team whose
 * metric went from 0.3 to 30 would otherwise dominate, and it is the typical
 * response a scout experiences that matters.
 */
function responsiveness(rows: readonly Row[], candidateId: string): { median: number; events: number } {
  const byTeam = new Map<string, Row[]>();
  for (const row of rows) {
    const list = byTeam.get(row.teamKey);
    if (list === undefined) byTeam.set(row.teamKey, [row]);
    else list.push(row);
  }

  const ratios: number[] = [];
  for (const teamRows of byTeam.values()) {
    teamRows.sort((a, b) => a.matchIndex - b.matchIndex);
    if (teamRows.length < REGIME_WINDOW * 2 + 1) continue;
    for (let i = REGIME_WINDOW; i + REGIME_WINDOW <= teamRows.length - 1; i++) {
      const before = teamRows.slice(i - REGIME_WINDOW, i);
      const after = teamRows.slice(i + 1, i + 1 + REGIME_WINDOW);
      if (after.length < REGIME_WINDOW) continue;
      const shift = Math.abs(mean(after.map((r) => r.dev)) - mean(before.map((r) => r.dev)));
      if (shift < REGIME_SHIFT_POINTS) continue;

      const scaleBefore = mean(before.map((r) => r.byCandidate.get(candidateId)!.scale));
      const scaleAfter = mean(after.map((r) => r.byCandidate.get(candidateId)!.scale));
      if (scaleBefore > 0 && Number.isFinite(scaleAfter)) ratios.push(scaleAfter / scaleBefore);
    }
  }
  return { median: median(ratios), events: ratios.length };
}

/**
 * SEPARATION — does the metric read lower for steady robots than erratic ones?
 *
 * Each row is labelled by the realized spread of its team's TRAILING
 * `REGIME_WINDOW * 2` deviations. Rows in the bottom quintile of that spread are
 * "quiet", the top quintile "volatile". The returned ratio is the metric's mean
 * on quiet rows over its mean on volatile rows — LOWER is better, and a value
 * near 1 means the metric barely distinguishes them at all.
 */
function separation(rows: readonly Row[], candidateId: string): { ratio: number; quiet: number; volatile: number } {
  const byTeam = new Map<string, Row[]>();
  for (const row of rows) {
    const list = byTeam.get(row.teamKey);
    if (list === undefined) byTeam.set(row.teamKey, [row]);
    else list.push(row);
  }

  const labelled: { spread: number; scale: number }[] = [];
  const window = REGIME_WINDOW * 2;
  for (const teamRows of byTeam.values()) {
    teamRows.sort((a, b) => a.matchIndex - b.matchIndex);
    for (let i = window; i < teamRows.length; i++) {
      const trailing = teamRows.slice(i - window, i).map((r) => r.dev);
      const trailingMean = mean(trailing);
      const spread = Math.sqrt(mean(trailing.map((d) => (d - trailingMean) ** 2)));
      const scale = teamRows[i]!.byCandidate.get(candidateId)!.scale;
      if (Number.isFinite(spread) && Number.isFinite(scale)) labelled.push({ spread, scale });
    }
  }
  if (labelled.length < 10) return { ratio: Number.NaN, quiet: Number.NaN, volatile: Number.NaN };

  const sorted = [...labelled].sort((a, b) => a.spread - b.spread);
  const cut = Math.floor(sorted.length / 5);
  const quiet = mean(sorted.slice(0, cut).map((r) => r.scale));
  const volatileMean = mean(sorted.slice(sorted.length - cut).map((r) => r.scale));
  return { ratio: volatileMean > 0 ? quiet / volatileMean : Number.NaN, quiet, volatile: volatileMean };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasons = parseSeasons(args[args.indexOf("--seasons") + 1] ?? "2024-2025");
  const algorithmsSpec = args.indexOf("--algorithms") === -1 ? undefined : args[args.indexOf("--algorithms") + 1];
  const algorithms = resolvePublishAlgorithms(algorithmsSpec);

  console.log(`SIGMA SCORE vs SWING SCORE — quick task 260910-u7g (experiment, not wired into publish)`);
  console.log(`algorithms: ${algorithms.map((a) => `${a.id}@${a.version}`).join(", ")}`);
  console.log(`seasons:    ${seasons.join(", ")}   official play only`);
  console.log(`swing half-life ${SWING_FACTOR_HALF_LIFE_MATCHES} (decay ${swingDecayFor(SWING_FACTOR_HALF_LIFE_MATCHES).toFixed(4)})\n`);
  console.log(`Every candidate is scored on the SAME rows against the SAME target (the actual raw next`);
  console.log(`deviation), supplying its own location AND scale. n is team-matches, not independent`);
  console.log(`observations — even-split gives all three teammates the identical deviation.\n`);
  for (const candidate of CANDIDATES) console.log(`   ${candidate.id.padEnd(20)} ${candidate.note}`);
  console.log("");

  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    for (const algorithm of algorithms) {
      console.log(`═══ ${algorithm.id}@${algorithm.version} ═══\n`);
      const rows: Row[] = [];
      for (const season of seasons) {
        const matches = buildSeasonStream(db, season, {});
        if (matches.length === 0) continue;
        rows.push(...runSeason(algorithm, season, matches));
      }
      if (rows.length === 0) {
        console.log(`   no rows\n`);
        continue;
      }

      console.log(`   ${rows.length} team-match rows\n`);
      console.log(
        `   candidate             medianNLL   trim99NLL     meanNLL   Spearman   coverage   meanScale   control`
      );
      const scored = CANDIDATES.map((c) => ({ candidate: c, score: scoreCandidate(rows, c.id) }));
      // Flagged on TRIM99, not median. The median is improper here — it rewards
      // over-confidence, and coverage shows the incumbent IS over-confident, so
      // flagging the median winner would recommend the wrong candidate.
      const bestTrimmed = Math.min(...scored.map((s) => s.score.trimmedNll));
      for (const { candidate, score } of scored) {
        const flag = score.trimmedNll === bestTrimmed ? "  <- best trim99" : "";
        console.log(
          `   ${candidate.id.padEnd(20)} ${score.medianNll.toFixed(4).padStart(9)}   ${score.trimmedNll.toFixed(4).padStart(9)}   ${score.meanNll.toFixed(2).padStart(9)}   ` +
            `${score.spearman.toFixed(4).padStart(8)}   ${(score.coverage * 100).toFixed(1).padStart(7)}%   ` +
            `${score.meanScale.toFixed(2).padStart(9)}   ${score.control.toFixed(4).padStart(7)}${flag}`
        );
      }
      console.log(
        `   coverage target is ${(GAUSSIAN_1SIGMA_COVERAGE * 100).toFixed(1)}% for an honest 1 sigma; control must be far below Spearman.`
      );

      console.log(`\n   THE DEVELOPER'S TWO REQUIREMENTS`);
      console.log(`   candidate             responsiveness (higher better)   separation (lower better)`);
      for (const candidate of CANDIDATES) {
        const r = responsiveness(rows, candidate.id);
        const s = separation(rows, candidate.id);
        console.log(
          `   ${candidate.id.padEnd(20)} ${r.median.toFixed(3).padStart(10)} over ${String(r.events).padStart(6)} shifts   ` +
            `${s.ratio.toFixed(3).padStart(10)}  (quiet ${s.quiet.toFixed(2)} vs volatile ${s.volatile.toFixed(2)})`
        );
      }
      console.log(
        `   responsiveness = median ratio of the metric AFTER a >=${REGIME_SHIFT_POINTS}pt level shift to before it.`
      );
      console.log(`   separation     = metric on steady robots / metric on erratic robots.\n`);
    }
  } finally {
    db.close();
  }
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("compare:sigma-score failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
