/**
 * BPR - Bayesian Power Rating.
 *
 * A per-team latent scoring contribution tracked by a Gaussian filter in
 * SCALE-FREE units: a rating of 1.0 is a league-average team, measured in
 * multiples of (average alliance output / 3). The point scale is estimated
 * online and cancels out of the win probability, which is what lets one
 * parameter set apply to a season whose scoring level was never observed
 * when the parameters were chosen.
 *
 * `scale` is NOT a season-level constant, despite what "the season's point
 * scale" would suggest and what this comment claimed until 2026-09-10.
 * `scaleMinLr` floors the learning rate at 0.01 and `scaleCount` never resets
 * (see `carrySeason`), so it is a ~100-match trailing EWMA over the GLOBALLY
 * INTERLEAVED match stream — during a peak week that is roughly 4% of the
 * weekend's matches, drawn from whichever unrelated events happen to sit
 * adjacent in sort order. Measured over 2026 (208 events): the value at an
 * event's last match misses that event's own mean alliance score by a median
 * of 28%, 68% at the 90th percentile, and +123% at week-0 events still
 * carrying the prior season's level. It is a rolling global reference, never
 * "points per league-average robot at this event".
 *
 * That imprecision does not reach a published number, because `r` is fit
 * against the SAME reference that `teamMetrics` multiplies back in: an
 * inflated scale depresses `r` by the same factor and the product is
 * unchanged. Verified 2026-09-10 against event-scoped OPR over 135 events and
 * 3,638 teams — the median BPR/OPR ratio per event has correlation -0.067
 * with that event's scoring level, i.e. flat across a 5x range. What the
 * cancellation does NOT survive is reading `muL + muS` on its own: a team
 * measured while the global EWMA was low carries a higher `r` for the same
 * output, so the scale-free rating is not comparable BETWEEN teams and must
 * never be ranked, tiered, or published raw. Only `r * unit` is comparable.
 *
 * PROVENANCE. Structure and hyperparameters were selected using ONLY seasons
 * 2016-2022, then evaluated once on a sealed 2023-2026 holdout: 78.05% winner
 * accuracy over 69,511 matches (78.37% over qualification matches alone). The
 * research harness, the pre-committed selection rule and the single-shot
 * holdout run live in `packages/bpr/` and
 * `.planning/quick/260908-b4t-fresh-2023-blind-model/`. Re-tuning this model
 * against 2023 or later converts that holdout into a training set and voids
 * the number above.
 *
 * QUICK TASK 260910-4bf (2026-09-10) changed the scoring target AFTER that
 * evaluation ran: the target now also subtracts TBA's `adjustPoints` — a
 * manual scorekeeper correction — alongside `foulPoints` (see
 * `correctionsOf` below). The 78.05% figure above therefore describes the
 * revision of this file that predates this change, not this one. Measured
 * deltas were +0.087pp accuracy / -0.00036 Brier on 2023 (design-adjacent)
 * and +0.003pp / -0.00009 on the 2024-25 holdout slice — BOTH accuracy
 * intervals spanned zero. The change is justified by attribution — a
 * scorekeeper correction is not robot performance — not by measured
 * accuracy.
 *
 * Four components earned their place on design-year evidence, each beating a
 * two-standard-error bar (0.31pp on 82,946 matches):
 *
 *   season carryover        +1.80pp
 *   two-timescale state     +1.05pp
 *   anti-additivity         +0.53pp
 *   foul-adjusted signal    +0.30pp
 *   online link calibration  0.00pp accuracy, log loss 0.557 -> 0.529
 *
 * Five further ideas were tried and REJECTED as inside noise, and are
 * deliberately absent here rather than present-but-disabled: a per-team
 * foul-conceded submodel, elimination down-weighting, defensive suppression,
 * Huber robustness, and a learned red-side bias. `packages/bpr/model.ts`
 * retains them behind inert defaults for future research.
 *
 * Like `opr.ts` and `epa.ts`, and unlike `vpr`, BPR carries no ranking-point
 * model, so it emits no `redRpPmf`/`blueRpPmf` and cannot drive the rank
 * simulation. That is a deliberate scope boundary, not an omission.
 *
 * DISPLAYED UNCERTAINTY IS CALIBRATED SEPARATELY from the filter's internal
 * variance, because the two are not the same number — see `displaySdFactor`.
 * The filter's own variance is ~2x its realized variance, which `tau` hides in
 * the win probability but which used to ship straight to the screen.
 */
import { TOTAL_METRIC_KEY, type AlgorithmModule, type MatchResult, type Prediction, type SeasonBoundary, type TeamMetrics, type UpcomingMatch } from "./types.js";
import {
  COMPONENT_GROUP_IDS,
  COMPONENT_GROUP_METRIC_KEYS,
  componentsInGroup,
  tryParseBreakdownPair,
  type ComponentGroupId,
} from "./breakdown/index.js";

export interface SprParams {
  /** Observation noise sd on alliance output, normalized units. */
  readonly obsSd: number;
  /** Process noise (variance) added to the slow component per match played. */
  readonly qSlow: number;
  /** Mean-reversion factor for the fast component, per match played. */
  readonly rhoFast: number;
  /** Process noise (variance) for the fast component per match played. */
  readonly qFast: number;
  /** Prior variance for a team never seen before. */
  readonly priorVar: number;
  /** Prior variance of the fast component. */
  readonly fastPriorVar: number;
  /** Prior mean rating for a never-seen team (1.0 = league average). */
  readonly rookieMean: number;
  /** Variance added to the slow component at a season boundary. */
  readonly seasonVar: number;
  /** Initial link temperature. */
  readonly tau0: number;
  /** Online learning rate for log-tau. */
  readonly tauLr: number;
  /** Adaptation floor for the online season-scale estimate. */
  readonly scaleMinLr: number;
  /** Anti-additivity weights for the 2nd and 3rd strongest team in an alliance. */
  readonly w2: number;
  readonly w3: number;
  /**
   * Allocate an alliance's surprise by EXPECTED rank rather than by sorted
   * point estimate. Mirrors `packages/bpr/model.ts`'s `softCredit` exactly —
   * see that file for the measurement and the reasoning. `false` reproduces
   * the sorted-rank assignment, so the knob is inert at its default.
   */
  readonly softCredit: boolean;
}

/**
 * DISPLAY-TIME variance calibration.
 *
 * The filter does not believe its own variance. Quick task 260910-25c formed
 * the standardized innovation `z = (observed - mu) / sqrt(pv + obsSd^2)` over
 * the design era (166,188 alliance-observations) and measured `sd(z) = 0.7062`
 * against an honest 1.0, with the learned link temperature converging to
 * 0.45-0.63 in every season and never near 1.0.
 *
 * The cause is that `obsSd` does two contradictory jobs: it sets the Kalman
 * gain (`k = w*p / (pv + obsSd^2)`) AND the stated uncertainty. It was selected
 * for winner accuracy, i.e. for the gain, and the online `tau` then repairs the
 * consequence in `pRedWin`. Nothing repaired it in the variance this module
 * EMITS — which is published (`pageArtifacts.ts`) and rendered directly as the
 * displayed `X +/- Y` (`EventMatchTable.tsx`). The interval shipped ~1.42x too
 * wide, and wrongly so by a strength-dependent amount (2022 quintiles ran
 * sd(z) 0.551 -> 1.001, i.e. 1.8x too wide for weak alliances).
 *
 * The benign explanation was tested and FAILED: `corr(z_red, z_blue) = 0.011`,
 * so the independence assumption is fine and only the level is wrong.
 *
 * Fitted by weighted least squares over design-era deciles
 * (`.planning/quick/260910-2pt-.../fit-output.txt`):
 *
 *   sd(z) = 0.7058 + 0.0844 * (mu - 3)
 *
 * Applying it lands overall sd(z) at 1.0001 and tightens the strength quintiles
 * from 0.551-1.001 to 0.961-1.022.
 *
 * WHY THIS DOES NOT VOID THE SEALED HOLDOUT. The factor is applied ONLY to the
 * emitted variance fields. It never enters `z`, never enters `pRedWin`, and
 * never enters a Kalman gain, so every winner call and every probability this
 * module produces is bit-identical to the frozen model's. The sealed 78.05% is
 * a statement about winner accuracy and is untouched. `bpr.test.ts` pins that
 * invariance directly.
 *
 * DESIGN-ERA ONLY. The fit reads 2016-2022 and spends no holdout.
 */
const DISPLAY_SD_A = 0.7058;
const DISPLAY_SD_B = 0.0844;
/**
 * Safety rails for alliance strengths outside the fitted range. Neither binds
 * anywhere in 2016-2022 (observed mu spans 0.283 to 8.099, giving c in
 * 0.477..1.136); they exist so a future season with an extreme rating cannot
 * produce a non-positive or absurd interval.
 */
const DISPLAY_SD_MIN = 0.4;
const DISPLAY_SD_MAX = 1.3;

/** Calibration multiplier on the DISPLAYED standard deviation at strength `mu`. */
function displaySdFactor(mu: number): number {
  return Math.min(DISPLAY_SD_MAX, Math.max(DISPLAY_SD_MIN, DISPLAY_SD_A + DISPLAY_SD_B * (mu - 3)));
}

/**
 * Frozen 2026-09-08. Chosen on 2016-2022 alone by the pre-committed rule in
 * `.planning/quick/260908-b4t-fresh-2023-blind-model/DECISION.md`. Design-era
 * accuracy 73.081%; sealed holdout accuracy 78.05%.
 */
export const SPR_PARAMS: SprParams = {
  obsSd: 1,
  qSlow: 0.00002,
  rhoFast: 0.9,
  qFast: 0.015,
  priorVar: 0.1,
  fastPriorVar: 0.25,
  rookieMean: 0.55,
  seasonVar: 0.03,
  tau0: 1,
  tauLr: 0.005,
  scaleMinLr: 0.01,
  w2: 0.7,
  w3: 0.5,
  softCredit: true,
};

/**
 * D-13 requires a `{codeVersion}+{paramSetName}` shape, because the paramSetName
 * half becomes part of every published artifact key. `baseline` is the same
 * suffix `opr` (4.0.0+baseline) and `epa` (5.0.0+baseline) carry, and it is the
 * honest one here: BPR has no tuned parameter file and is never touched by
 * `applyPromotedOverrides`. Its constants were frozen once, on 2016-2022
 * evidence, and are not re-tuned per season.
 *
 * Bumped 1.0.0 -> 2.0.0 (quick task 260910-2pt): `predict()`'s observable output
 * changed. `variance`, `redScoreVarianceOwn` and `blueScoreVarianceOwn` are now
 * multiplied by `displaySdFactor(mu)^2`, so every interval this module has ever
 * published moves (~1.42x narrower overall, more at low alliance strength).
 * MAJOR under D-13's rule that no artifact key may stand for two structurally
 * different outputs.
 *
 * Bumped 2.0.0 -> 3.0.0: `pRedWin` and `winner` now change too, for two
 * independent reasons landed back to back.
 *
 *  1. The scoring target dropped TBA's `adjustPoints` (commit 7c88e234). That
 *     commit altered every prediction this module makes but left the version at
 *     2.0.0, which under D-13 would leave one artifact key standing for two
 *     structurally different outputs. This bump covers it.
 *  2. `softCredit` allocates an alliance's surprise by EXPECTED rank instead of
 *     sorted point estimate, so ratings — and therefore predictions — move.
 *
 * The sealed 78.05% holdout accuracy no longer describes this module. It
 * describes the revision that predates both changes. Neither change is an
 * accuracy claim: the adjust drop measured +0.003pp on 2024-25 with the
 * interval spanning zero, and softCredit measured +0.014pp likewise. Both are
 * correctness arguments, not performance ones.
 *
 * The paramSetName stays `baseline`: `applyPromotedOverrides` still never
 * touches BPR, and `softCredit` is a structural correction rather than a tuned
 * value.
 */
export const SPR_VERSION = "3.0.0+baseline";

/**
 * The two-timescale state, described by what the FROZEN PARAMETERS actually do
 * rather than by the talent-versus-form story it was designed around. Quick
 * task 260910-25c simulated the filter's own variance recursions under
 * `SPR_PARAMS` and found `qSlow = 0.00002` (the floor of its search grid)
 * against `qFast = 0.015`, a 750x ratio:
 *
 *   at steady state pL = 0.0051 and pS = 0.0624, so 92.5% of every rating
 *   update lands in the FAST component — which decays 10% per match
 *   (half-life 6.6 matches) and is then ZEROED at each season boundary.
 *   Over a fresh 60-match season only 22.2% of the evidence the filter
 *   absorbs ever reaches the mean that carries forward.
 *
 * So this is not "underlying quality plus current form". It is an annual
 * re-baseline (`muL`, re-opened each winter by `seasonVar`) plus a ~6.6-match
 * exponential form rating (`muS`) that is discarded every winter. The mechanism
 * is real and earned its +1.05pp; only the names were wrong.
 */
export interface SprTeamState {
  /** Near-frozen per-team offset; re-opened for a short window each season. */
  readonly muL: number;
  readonly pL: number;
  /** Fast mean-reverting component; carries ~92% of each update, reset yearly. */
  readonly muS: number;
  readonly pS: number;
}

/** Per-phase quantities, keyed by the shared `auto`/`teleop`/`endgame` group ids. */
export type SprPhaseRecord<T> = Readonly<Record<ComponentGroupId, T>>;

function phaseRecord<T>(make: (phase: ComponentGroupId) => T): SprPhaseRecord<T> {
  const out = {} as Record<ComponentGroupId, T>;
  for (const phase of COMPONENT_GROUP_IDS) out[phase] = make(phase);
  return out;
}

export interface SprState {
  readonly season: number | null;
  readonly teams: ReadonlyMap<string, SprTeamState>;
  /** Log of the online link temperature. */
  readonly logTau: number;
  /** Online estimate of mean foul-adjusted alliance output, in points. */
  readonly scale: number;
  readonly scaleCount: number;
  /**
   * DISPLAY ONLY. Three independent filters per team -- auto, teleop, endgame --
   * kept in their OWN map, deliberately not inside `teams`. `predict` reads
   * `teams` and never touches anything below this line, so the structural
   * isolation is visible in the type rather than resting on a convention;
   * `bpr.test.ts` pins it with a bit-identity check against the pre-component
   * model.
   *
   * Why this is display-only and not a prediction input: a component split has
   * to read per-season `score_breakdown` field names, and for 2023-2026 those
   * were holdout schema. Feeding them into `predict` would make the sealed
   * 78.05% stop describing the shipped predictor. See this task's PLAN.md
   * (`.planning/quick/260908-pcm-bpr-display-only-phase-components/`).
   */
  readonly phaseTeams: SprPhaseRecord<ReadonlyMap<string, SprTeamState>>;
  /** Each phase's own online point scale — auto and endgame are worth far fewer points than teleop, so they cannot share the total's. */
  readonly phaseScale: SprPhaseRecord<number>;
  readonly phaseScaleCount: SprPhaseRecord<number>;
}

const SQRT2PI = Math.sqrt(2 * Math.PI);
const normPdf = (z: number): number => Math.exp(-0.5 * z * z) / SQRT2PI;

/** Abramowitz-Stegun 7.1.26; ~1e-7 absolute accuracy. */
function erf(x: number): number {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-a * a);
  return s * y;
}
/**
 * Exact at z=0 by symmetry, special-cased because the A-S approximation above
 * returns +1.0e-9 rather than 0 there, making `normCdf(0)` come out as
 * 0.5000000005. That residual is numerically irrelevant to Brier or accuracy
 * (the `pRedWin >= 0.5` tiebreak already resolves an even matchup to red), but
 * it is NOT irrelevant to reporting: `packages/core/scoring/brier.ts` detects a
 * no-call by exact equality with 0.5, so without this line a genuinely even
 * prediction is silently recorded as a confident red pick. That hid all 275 of
 * BPR's dead-even cold-start matches (274 in 2016, 1 in 2017) from the
 * published no-call count. Mirrors the same guard `sigma1/linkFunctions.ts`
 * already applies to its own erf-based CDF.
 */
const normCdf = (z: number): number => (z === 0 ? 0.5 : 0.5 * (1 + erf(z / Math.SQRT2)));

function freshTeam(p: SprParams): SprTeamState {
  return { muL: p.rookieMean, pL: p.priorVar, muS: 0, pS: p.fastPriorVar };
}

/**
 * Foul points awarded TO an alliance are earned by the OPPONENT's fouls, so
 * they are opponent-attributable and are removed from the skill signal rather
 * than credited to the alliance that received them. `adjustPoints` is a
 * manual scorekeeper correction, attributable to no robot, and is removed for
 * the same reason (quick task 260910-4bf). `totalPoints`, `foulPoints` and
 * `adjustPoints` were verified present under those exact keys in all ten
 * registered seasons 2016-2026 (every season module's Zod schema declares
 * `adjustPoints: z.number().finite()`); no other breakdown field is touched,
 * deliberately, because field names are not stable across seasons (2026
 * renamed `autoPoints` to `totalAutoPoints`).
 *
 * This reads the raw fields directly rather than through the season
 * component map (`ADJUST_COMPONENT` / `tryParseBreakdownPair`), even though
 * both route to the identical value in every registered season. Two reasons,
 * verified against HEAD before this change landed: `state.season` is `null`
 * for the whole first replayed season (`initState` sets it null, and
 * `carrySeason` only runs when a prior state exists), so a component-map read
 * would make `adjust` invisible for a whole season here while
 * `packages/bpr/data.ts` (which always has `meta.year`) subtracted it —
 * exactly the cross-module divergence this rule must not have. And
 * `componentMapForSeason` throws for an unregistered season, which would turn
 * a future unregistered season into a hard failure of the live update path
 * rather than a degrade-to-zero. The shallow read is numerically identical to
 * the component-map read on every successfully parsed payload. See
 * `packages/bpr/scoringTarget.test.ts` — the only thing holding this
 * implementation and `packages/bpr/data.ts`'s in sync.
 */
export interface ScoreCorrections {
  readonly redFoul: number;
  readonly blueFoul: number;
  readonly redAdjust: number;
  readonly blueAdjust: number;
}

const ZERO_CORRECTIONS: ScoreCorrections = { redFoul: 0, blueFoul: 0, redAdjust: 0, blueAdjust: 0 };

function numberField(alliance: Record<string, unknown>, field: string): number {
  const v = alliance[field];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function allianceFields(parsed: unknown, side: "red" | "blue"): Record<string, unknown> | null {
  if (parsed === null || typeof parsed !== "object") return null;
  const alliance = (parsed as Record<string, unknown>)[side];
  return alliance !== null && typeof alliance === "object" ? (alliance as Record<string, unknown>) : null;
}

export function correctionsOf(raw: string | null): ScoreCorrections {
  if (raw === null) return ZERO_CORRECTIONS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return ZERO_CORRECTIONS;
  }
  const red = allianceFields(parsed, "red");
  const blue = allianceFields(parsed, "blue");
  return {
    redFoul: red ? numberField(red, "foulPoints") : 0,
    blueFoul: blue ? numberField(blue, "foulPoints") : 0,
    redAdjust: red ? numberField(red, "adjustPoints") : 0,
    blueAdjust: blue ? numberField(blue, "adjustPoints") : 0,
  };
}

interface AllianceView {
  mu: number;
  pv: number;
  keys: string[];
  states: SprTeamState[];
  /** Weights defining the alliance's predicted output. Always hard-ranked. */
  weights: number[];
  /**
   * Weights allocating the innovation across teams in `foldRatings`. Identical
   * to `weights` unless `softCredit` is on.
   */
  creditWeights: number[];
}

/**
 * `base` = [1, w2, w3] evaluated at a fractional, 1-indexed rank. At integer
 * ranks this returns the base entry exactly, which is what makes softCredit
 * collapse onto the hard assignment whenever the ordering is certain.
 */
function interpolateWeight(base: readonly number[], rank: number): number {
  const last = base.length - 1;
  const r = Math.min(last + 1, Math.max(1, rank));
  const lo = Math.min(last, Math.floor(r - 1));
  const hi = Math.min(last, lo + 1);
  const t = r - 1 - lo;
  return (base[lo] ?? 1) + t * ((base[hi] ?? 1) - (base[lo] ?? 1));
}

/**
 * Rank weighting. Teams are ranked within their alliance and contribute with
 * weights (1, w2, w3), renormalized to sum to 3 so the scale-free property
 * survives any alliance size.
 *
 * WHAT THIS ACTUALLY DOES, corrected by quick task 260910-25c. The docstring
 * here used to call this "anti-additivity" and justify it as field congestion —
 * "three elite scorers do not add linearly". The renormalization inverts that.
 * With w2=0.7, w3=0.5 the live weights are (1.3636, 0.9545, 0.6818), and the
 * LARGEST weight is matched to the LARGEST rating, so by Chebyshev's sum
 * inequality the weighted sum is >= the plain sum for EVERY alliance, with
 * equality only when all three ratings are identical:
 *
 *   (1.00, 1.00, 1.00) -> 3.000 vs 3.000 plain   (1.000x)
 *   (1.20, 1.00, 0.80) -> 3.136 vs 3.000 plain   (1.046x)
 *   (2.00, 1.00, 0.50) -> 4.023 vs 3.500 plain   (1.149x)
 *   (3.00, 0.60, 0.40) -> 4.936 vs 4.000 plain   (1.234x)
 *
 * So this is a SPREAD AMPLIFIER, not a suppressor: it says a star-plus-two-weak
 * alliance outscores three mediocre robots of the same total rating. That is a
 * real empirical claim the design era endorsed at +0.53pp — it is simply the
 * opposite of the mechanism this comment used to assert.
 *
 * Two known artifacts, documented rather than fixed (fixing either needs a
 * re-tune, and BPR tuning is closed):
 *   - the weights are a STEP function of a noisy ordering, so teammates whose
 *     ratings differ by 1e-9 receive weights differing by 43%;
 *   - exact ties fall through to the ascending-index tiebreak below, so three
 *     equally-rated teams (any all-rookie alliance) give driver station 1 twice
 *     the Kalman credit of station 3 on identical evidence.
 */
function viewOfMap(
  teams: ReadonlyMap<string, SprTeamState>,
  keys: readonly string[],
  p: SprParams,
): AllianceView {
  const states: SprTeamState[] = [];
  const mus: number[] = [];
  const kept: string[] = [];
  for (const k of keys) {
    const s = teams.get(k) ?? freshTeam(p);
    states.push(s);
    kept.push(k);
    mus.push(s.muL + s.muS);
  }
  const n = states.length;
  const base = [1, p.w2, p.w3];
  const order = mus.map((_, i) => i).sort((a, b) => (mus[b] ?? 0) - (mus[a] ?? 0) || a - b);
  let raw = 0;
  for (let rank = 0; rank < n; rank += 1) raw += base[Math.min(rank, base.length - 1)] ?? 1;
  const norm = raw > 0 ? 3 / raw : 1;

  const weights = new Array<number>(n).fill(1);
  for (let rank = 0; rank < n; rank += 1) {
    const idx = order[rank];
    if (idx === undefined) continue;
    weights[idx] = (base[Math.min(rank, base.length - 1)] ?? 1) * norm;
  }

  let creditWeights = weights;
  if (p.softCredit) {
    const rawCredit = new Array<number>(n).fill(1);
    for (let i = 0; i < n; i += 1) {
      const si = states[i];
      if (si === undefined) continue;
      let expected = 1;
      for (let j = 0; j < n; j += 1) {
        if (i === j) continue;
        const sj = states[j];
        if (sj === undefined) continue;
        const sd = Math.sqrt(Math.max(si.pL + si.pS + sj.pL + sj.pS, 1e-12));
        expected += normCdf(((mus[j] ?? 0) - (mus[i] ?? 0)) / sd);
      }
      rawCredit[i] = interpolateWeight(base, expected);
    }
    let creditSum = 0;
    for (const w of rawCredit) creditSum += w;
    const creditNorm = creditSum > 0 ? 3 / creditSum : 1;
    creditWeights = rawCredit.map((w) => w * creditNorm);
  }

  let mu = 0;
  let pv = 0;
  for (let i = 0; i < n; i += 1) {
    const s = states[i];
    const w = weights[i];
    if (s === undefined || w === undefined) continue;
    mu += w * (mus[i] ?? 0);
    pv += w * w * (s.pL + s.pS);
  }
  return { mu, pv, keys: kept, states, weights, creditWeights };
}

function freshTeamMap(teams: readonly string[]): Map<string, SprTeamState> {
  const map = new Map<string, SprTeamState>();
  for (const t of teams) map.set(t, freshTeam(SPR_PARAMS));
  return map;
}

function initState(teams: string[]): SprState {
  return {
    season: null,
    teams: freshTeamMap(teams),
    logTau: Math.log(SPR_PARAMS.tau0),
    scale: 0,
    scaleCount: 0,
    phaseTeams: phaseRecord(() => freshTeamMap(teams)),
    phaseScale: phaseRecord(() => 0),
    phaseScaleCount: phaseRecord(() => 0),
  };
}

function predict(state: SprState, match: UpcomingMatch): Prediction {
  const p = SPR_PARAMS;
  const red = viewOfMap(state.teams, match.redTeams, p);
  const blue = viewOfMap(state.teams, match.blueTeams, p);

  const d = red.mu - blue.mu;
  const v = red.pv + blue.pv + 2 * p.obsSd ** 2;
  const tau = Math.exp(state.logTau);
  const z = d / (tau * Math.sqrt(Math.max(v, 1e-9)));
  const pRedWin = Math.min(1 - 1e-6, Math.max(1e-6, normCdf(z)));

  // Ratings are scale-free; multiply back into points for display. Before any
  // match has been folded the scale is unknown, and 0 is the honest answer -
  // never a guessed constant.
  const unit = state.scale / 3;

  // Display-time variance calibration. `z` and `pRedWin` above are computed
  // from the RAW `v` and are untouched by this; only what we emit is rescaled.
  // See `displaySdFactor`'s doc comment for the measurement and the reasoning.
  const cRed = displaySdFactor(red.mu);
  const cBlue = displaySdFactor(blue.mu);
  const redOwn = (red.pv + p.obsSd ** 2) * cRed * cRed;
  const blueOwn = (blue.pv + p.obsSd ** 2) * cBlue * cBlue;

  return {
    winner: pRedWin >= 0.5 ? "red" : "blue",
    pRedWin,
    redScore: red.mu * unit,
    blueScore: blue.mu * unit,
    // The margin variance is the sum of the two calibrated alliance variances.
    // Summing them is what the model already assumed, and 260910-25c confirmed
    // the assumption holds: corr(z_red, z_blue) = 0.011.
    variance: (redOwn + blueOwn) * unit * unit,
    redScoreVarianceOwn: redOwn * unit * unit,
    blueScoreVarianceOwn: blueOwn * unit * unit,
  };
}

/**
 * One step of the online point-scale estimate. Extracted verbatim from the
 * total path so the phase filters use the SAME rule rather than a second
 * transcription of it.
 */
function stepScale(
  prevScale: number,
  prevCount: number,
  obsMean: number,
  p: SprParams,
): { scale: number; count: number } {
  const count = prevCount + 1;
  const seed = prevCount === 0 ? Math.max(obsMean, 1) : prevScale;
  const lr = Math.max(p.scaleMinLr, 1 / (count + 1));
  return { scale: seed + lr * (obsMean - seed), count };
}

/**
 * The rank-weighted Kalman fold for ONE match, over one team map. Both
 * alliances are scored against the PRE-match state, so the two observations
 * within a match cannot inform each other.
 *
 * Shared by the total filter and the three phase filters. Extracted rather
 * than copied specifically so a phase can never drift onto slightly different
 * math than the quantity it decomposes.
 */
function foldRatings(
  teams: ReadonlyMap<string, SprTeamState>,
  red: AllianceView,
  blue: AllianceView,
  redOut: number,
  blueOut: number,
  sc: number,
  p: SprParams,
): Map<string, SprTeamState> {
  const next = new Map(teams);
  const corrections = new Map<string, SprTeamState>();

  for (const [side, out] of [
    [red, redOut],
    [blue, blueOut],
  ] as const) {
    const u = (3 * out) / sc;
    const innov = u - side.mu;
    const sTot = side.pv + p.obsSd ** 2;
    for (let i = 0; i < side.states.length; i += 1) {
      const s = side.states[i];
      const w = side.creditWeights[i];
      const key = side.keys[i];
      if (s === undefined || w === undefined || key === undefined) continue;
      // Observation row is H_i = w, so the gain carries the same weight: a
      // team the model believes contributes less also absorbs less surprise.
      // Under softCredit this is the EXPECTED-rank weight rather than the
      // sorted one, deliberately breaking strict Kalman consistency with
      // `side.mu` above — see packages/bpr/model.ts's softCredit doc.
      const kL = (w * s.pL) / sTot;
      const kS = (w * s.pS) / sTot;
      const prior = corrections.get(key) ?? s;
      corrections.set(key, {
        muL: prior.muL + kL * innov,
        muS: prior.muS + kS * innov,
        pL: Math.max(1e-6, prior.pL - kL * w * s.pL),
        pS: Math.max(1e-6, prior.pS - kS * w * s.pS),
      });
    }
  }

  // --- process noise, per match played ---
  for (const [key, s] of corrections) {
    next.set(key, {
      muL: s.muL,
      pL: s.pL + p.qSlow,
      muS: s.muS * p.rhoFast,
      pS: p.rhoFast ** 2 * s.pS + p.qFast,
    });
  }
  return next;
}

/** One alliance's output in one phase: its group components, summed. */
function phaseOutput(components: Readonly<Record<string, number>>, season: number, phase: ComponentGroupId): number {
  let total = 0;
  for (const name of componentsInGroup(season, phase)) total += components[name] ?? 0;
  return total;
}

/**
 * DISPLAY ONLY (see `SprState.phaseTeams`). Folds this match into the three
 * phase filters and returns the replacement phase state.
 *
 * Returns the state UNCHANGED, rather than folding zeros, whenever the phase
 * observation is not genuinely available: no season yet, no breakdown on the
 * match, or a breakdown that fails its season schema (measured at ~21% of
 * offseason matches carrying one). A zero here would publish as "this team
 * scores nothing in auto", which is a different and false claim from "not
 * measured".
 */
function foldPhases(
  state: SprState,
  result: MatchResult,
  p: SprParams,
): Pick<SprState, "phaseTeams" | "phaseScale" | "phaseScaleCount"> {
  const unchanged = {
    phaseTeams: state.phaseTeams,
    phaseScale: state.phaseScale,
    phaseScaleCount: state.phaseScaleCount,
  };
  const season = state.season;
  if (season === null) return unchanged;

  const parsed = tryParseBreakdownPair(season, result.scoreBreakdownRaw);
  if (parsed.kind !== "parsed") return unchanged;

  const teams: Record<ComponentGroupId, ReadonlyMap<string, SprTeamState>> = { ...state.phaseTeams };
  const scales: Record<ComponentGroupId, number> = { ...state.phaseScale };
  const counts: Record<ComponentGroupId, number> = { ...state.phaseScaleCount };

  for (const phase of COMPONENT_GROUP_IDS) {
    const redOut = phaseOutput(parsed.red, season, phase);
    const blueOut = phaseOutput(parsed.blue, season, phase);

    const stepped = stepScale(scales[phase], counts[phase], (redOut + blueOut) / 2, p);
    scales[phase] = stepped.scale;
    counts[phase] = stepped.count;

    const current = teams[phase];
    // Ranked WITHIN the phase, deliberately: the best auto robot on an
    // alliance is not necessarily its best robot overall, so reusing the
    // total's ordering here would misattribute a specialist.
    const red = viewOfMap(current, result.redTeams, p);
    const blue = viewOfMap(current, result.blueTeams, p);
    teams[phase] = foldRatings(current, red, blue, redOut, blueOut, Math.max(stepped.scale, 1e-6), p);
  }

  return { phaseTeams: teams, phaseScale: scales, phaseScaleCount: counts };
}

function update(state: SprState, result: MatchResult): SprState {
  const p = SPR_PARAMS;

  const { redFoul, blueFoul, redAdjust, blueAdjust } = correctionsOf(result.scoreBreakdownRaw);
  const redOut = result.redScore - redFoul - redAdjust;
  const blueOut = result.blueScore - blueFoul - blueAdjust;

  // --- online season scale, in points ---
  const { scale, count: scaleCount } = stepScale(state.scale, state.scaleCount, (redOut + blueOut) / 2, p);
  const sc = Math.max(scale, 1e-6);

  const red = viewOfMap(state.teams, result.redTeams, p);
  const blue = viewOfMap(state.teams, result.blueTeams, p);

  // --- link temperature: online gradient descent on log loss ---
  const d = red.mu - blue.mu;
  const v = red.pv + blue.pv + 2 * p.obsSd ** 2;
  const tau = Math.exp(state.logTau);
  const z = d / (tau * Math.sqrt(Math.max(v, 1e-9)));
  const pRed = Math.min(1 - 1e-6, Math.max(1e-6, normCdf(z)));
  const outcome = result.winner === "red" ? 1 : result.winner === "blue" ? 0 : 0.5;
  const grad = ((pRed - outcome) * normPdf(z) * z) / Math.max(pRed * (1 - pRed), 1e-6);
  const logTau = Math.min(
    Math.log(5),
    Math.max(Math.log(0.2), state.logTau + p.tauLr * grad),
  );

  // --- rating update; both alliances scored against the PRE-match state, so
  // the two observations within one match cannot inform each other ---
  const next = foldRatings(state.teams, red, blue, redOut, blueOut, sc, p);

  return {
    season: state.season,
    teams: next,
    logTau,
    scale,
    scaleCount,
    // Display-only, and deliberately last: everything above this line is
    // still the predictor, and `foldPhases` is still display-only and
    // deliberately last. It is NOT byte-for-byte what produced the sealed
    // 78.05% anymore — quick task 260910-4bf changed the scoring target
    // (dropping TBA's `adjustPoints`), so that figure describes the revision
    // of this file that predates this change, not this one. The measured
    // deltas had accuracy intervals spanning zero on both slices tested; the
    // change is justified by attribution (a scorekeeper correction is not
    // robot performance), not by measured accuracy.
    ...foldPhases(state, result, p),
  };
}

/**
 * Season carryover, the single largest component of the model (+1.80pp on
 * design years). Measured persistence of team strength across a season
 * boundary is r = 0.62-0.81, and it did NOT decay across the two-year COVID
 * gap (2020->2022, r = 0.739, higher than any single-year transition before
 * it) - team strength in FRC behaves like a property of the program rather
 * than of the current student roster.
 */
function carrySeason(state: SprState, boundary: SeasonBoundary): SprState {
  const p = SPR_PARAMS;
  if (boundary.isColdStart) {
    return {
      season: boundary.toSeason,
      teams: new Map(),
      logTau: Math.log(p.tau0),
      scale: 0,
      scaleCount: 0,
      phaseTeams: phaseRecord(() => new Map()),
      phaseScale: phaseRecord(() => 0),
      phaseScaleCount: phaseRecord(() => 0),
    };
  }
  const carryTeams = (teams: ReadonlyMap<string, SprTeamState>): Map<string, SprTeamState> => {
    const out = new Map<string, SprTeamState>();
    for (const [key, s] of teams) {
      out.set(key, {
        // The slow mean carries UNTOUCHED. A `seasonShrink` knob used to sit
        // here, but it was frozen at 1.0 — its whole expression reduced to the
        // identity, while reading as though a shrink toward league average
        // happened every winter. Removed by quick task 260910-2pt; deleting a
        // parameter pinned at its identity value changes no prediction.
        muL: s.muL,
        pL: s.pL + p.seasonVar,
        muS: 0,
        pS: p.fastPriorVar,
      });
    }
    return out;
  };
  const carried = carryTeams(state.teams);
  // The point scale carries too: a new season's scoring level is unknown until
  // its first matches land, and last season's level is the best available
  // starting guess.
  //
  // scaleCount deliberately does NOT reset. Resetting it would make the scale
  // re-adapt much faster at each boundary, which may well be better - but it
  // would be a DIFFERENT model from the one that was frozen on 2016-2022 and
  // measured at 78.05% on the sealed holdout, and that number is only
  // meaningful for the exact model that produced it. Changing this is a
  // research question for `packages/bpr/`, not a porting decision.
  return {
    season: boundary.toSeason,
    teams: carried,
    logTau: state.logTau,
    scale: state.scale,
    scaleCount: state.scaleCount,
    // Phases carry on exactly the total's rule, including the deliberate
    // non-reset of the scale counter documented above.
    phaseTeams: phaseRecord((phase) => carryTeams(state.phaseTeams[phase])),
    phaseScale: state.phaseScale,
    phaseScaleCount: state.phaseScaleCount,
  };
}

function teamMetrics(state: SprState, teams?: readonly string[]): TeamMetrics {
  // Points per league-average robot AS OF THIS CALL — a point sample of the
  // rolling global EWMA described in this file's header, not an event-local
  // or season-level constant. Publish calls this per match and keeps each
  // team's value from their own last official match, so every published
  // `value` pairs a team's `r` with the `unit` contemporaneous to it. Those
  // two must stay contemporaneous: pairing one team's `r` with another
  // instant's `unit` produces a number that is neither absolute points nor
  // field-relative (measured 2026-09-10: doing that inverted the NC top 10).
  const unit = state.scale / 3;
  const keys = teams ?? [...state.teams.keys()];
  const out: TeamMetrics = {};
  for (const key of keys) {
    const s = state.teams.get(key);
    if (s === undefined) continue;
    const metrics: TeamMetrics[string] = {
      [TOTAL_METRIC_KEY]: {
        value: (s.muL + s.muS) * unit,
        spread: Math.sqrt(Math.max(s.pL + s.pS, 0)) * unit,
      },
    };

    // Display-only phase roll-ups. A phase is emitted only once its own scale
    // has been established by at least one parsed breakdown; before that the
    // key is ABSENT, never 0 -- "not measured" and "scores nothing in auto"
    // are different claims and the client renders them differently.
    for (const phase of COMPONENT_GROUP_IDS) {
      if (state.phaseScaleCount[phase] === 0) continue;
      const ps = state.phaseTeams[phase].get(key);
      if (ps === undefined) continue;
      const phaseUnit = state.phaseScale[phase] / 3;
      metrics[COMPONENT_GROUP_METRIC_KEYS[phase]] = {
        value: (ps.muL + ps.muS) * phaseUnit,
        spread: Math.sqrt(Math.max(ps.pL + ps.pS, 0)) * phaseUnit,
      };
    }

    out[key] = metrics;
  }
  return out;
}

export const spr: AlgorithmModule<SprState> = {
  id: "spr",
  version: SPR_VERSION,
  initState,
  predict,
  update,
  teamMetrics,
  carrySeason,
  /**
   * Quick task 260910-kco (2026-09-10, ships inside the same 2.0.0 bump as
   * 260910-2pt, before any 2.0.0 artifact was published): season boundaries
   * carry the state as of the season's last OFFICIAL match, so offseason and
   * preseason exhibition play cannot seed the next season's prior — EPA's
   * 260908-615 mechanism. Design-era paired contrast on the production path:
   * accuracy delta −0.0145pp, 95% event-blocked CI [−0.113, +0.079] — a
   * statistical zero, adopted on principle: the sealed research model
   * (`packages/bpr/data.ts`) has never loaded an offseason match, so this
   * narrows production's unvalidated deviation from the sealed
   * configuration. Within-season offseason FOLDING is unchanged; only the
   * boundary crossing moves. Rule pre-registered at 0d9c402d before any
   * number existed; full contrast in the 260910-kco planning dir.
   */
  carryFrom: "last-official-match",
};
