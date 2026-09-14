/**
 * OPR (Offensive Power Rating) baseline — a no-variance AlgorithmModule.
 *
 * Event-scoped, quals-only, no-ridge — TBA's own definition: a fit over one
 * event's qualification matches, a plain minimum-norm pseudo-inverse
 * (verified against `matchstats_helper.py`'s `build_Minv_matrix`: filters
 * to `comp_level == "qm"`, calls bare `np.linalg.pinv(M)`, no ridge anywhere).
 *
 * No penalty term because event scope with quals only finishes a regional
 * at ~12 observations, where a ridge penalty would shrink ratings far more
 * than under season pooling; rank deficiency becomes a well-defined
 * minimum-norm answer once the term is gone.
 *
 * State is keyed by event, not reset, because `replay.ts`'s
 * `buildSeasonStream` interleaves concurrent events in one chronological
 * stream — resetting on every `eventKey` change would corrupt every
 * simultaneously-running event.
 */
import { Matrix, SingularValueDecomposition } from "ml-matrix";
import { TOTAL_METRIC_KEY, type AlgorithmModule, type MatchResult, type Prediction, type TeamMetrics, type UpcomingMatch } from "./types.js";
import { assertValidPRedWin } from "../scoring/predictionValidity.js";
import { isFullyDemoAlliance, remapDemoTeams } from "./demoTeams.js";
import { isFullyDqZeroScoreAlliance } from "./dq.js";
import {
  emptyExpandingStats,
  foldObservation,
  standardDeviation,
  type ExpandingStats,
} from "../scoring/expandingStats.js";

/**
 * Divisor turning this season's expanding-window alliance-score SD into the
 * logistic scale that converts a predicted score margin into a red-win
 * probability: `pRedWin = 1 / (1 + exp(-margin / scale))` with
 * `scale = standardDeviation(state.allianceScoreStats, OPR_FALLBACK_SCORE_SD)
 * / OPR_SCALE_DIVISOR_K`.
 *
 * The expanding-window form is leak-free by construction: it only ever
 * reflects matches already passed to `update`, and beats both a fixed
 * scale and a per-season-fit ceiling on measured Brier across five
 * seasons — see `docs/models/opr-baseline-change.md`.
 *
 * What this does not fix: OPR's no-call rate. A no-call is a predicted
 * margin of exactly 0 (an event-scoped, quals-only design matrix has no
 * rank at each event's start), and `0 / scale === 0` for any scale, so
 * those predictions stay at exactly 0.5, counted as misses.
 */
export const OPR_SCALE_DIVISOR_K = 1.1;

/**
 * Scale numerator used until `allianceScoreStats` holds at least 2 folded
 * scores — with `count < 2` the Welford SD is undefined, and this keeps
 * `predict` from producing a 0 or NaN scale on an event's opening matches.
 *
 * Equal in value to `EPA_FALLBACK_SCORE_SD` in `epa.ts`, deliberately, both
 * answering "what is a typical FRC alliance score SD before we have
 * measured one?" Declared here rather than imported because `epa.ts`
 * already imports `ratingEligibleTeams` from this module, so importing
 * back would create a module cycle. `opr.test.ts` pins the two to equality.
 */
export const OPR_FALLBACK_SCORE_SD = 25;

/** One alliance's rating-eligible observation: teams' columns (a 1 in the design matrix row) and the target score, adjusted for any surrogate offset (see `allianceObservation`). */
export interface OprObservation {
  readonly teams: readonly string[];
  readonly allianceScore: number;
}

/** One event's accumulated quals-only observations and current solved ratings. Module-private — only the outer `OprState.perEvent` map needs to name this shape. */
interface PerEventOprState {
  readonly observations: readonly OprObservation[];
  readonly ratings: ReadonlyMap<string, number>;
}

/**
 * `perEvent`: every event accumulated independently, keyed by `eventKey`.
 * `lastEventByTeam`: explicitly tracked, since map insertion order alone
 * would record a team's first event, not its most recent one, once two
 * events interleave.
 *
 * `allianceScoreStats`: the expanding-window Welford accumulator over every
 * alliance score folded so far, feeding `predict`'s logistic scale. Season-
 * wide even though OPR's ratings are strictly event-scoped, deliberately:
 * this is a link-function scale (how many points of margin constitute a
 * confident prediction this year), not a rating, so pooling it across a
 * season's events is the right estimator. No `carrySeason` is needed to
 * bound it — `opr` implements none, so it starts fresh every season.
 */
export interface OprState {
  readonly perEvent: ReadonlyMap<string, PerEventOprState>;
  readonly lastEventByTeam: ReadonlyMap<string, string>;
  readonly allianceScoreStats: ExpandingStats;
}

/**
 * Teams whose column should appear in the design matrix for this alliance:
 * every listed team except surrogates. A surrogate's contribution is still
 * accounted for via a subtracted offset (see `allianceObservation`), not
 * simply discarded.
 *
 * Disqualification policy is the opposite of surrogates for a partial
 * disqualification: a disqualified team physically played and contributed
 * to the score, and OPR models score contribution, so removing its column
 * would misattribute its real contribution to its teammates. It keeps its
 * column here; this function does not filter individual DQ'd teams. The
 * narrower whole-alliance-zero-score case is handled by `update()` below
 * dropping the entire observation before this function is even called
 * (`isFullyDqZeroScoreAlliance`, `dq.ts`).
 *
 * Demo-team handling (`demoTeams.ts`): every demo key is remapped to the
 * shared `DEMO_PSEUDO_TEAM_KEY` before the surrogate filter runs — the
 * opposite treatment from surrogates (removed) — so the design matrix
 * stays balanced and a demo robot's real contribution is never silently
 * reattributed to its real teammates. This is the one choke point every
 * algorithm in this project routes team identity through.
 */
export function ratingEligibleTeams(
  teams: readonly string[],
  surrogates: readonly string[]
): string[] {
  const remappedTeams = remapDemoTeams(teams);
  if (surrogates.length === 0) return remappedTeams;
  const surrogateSet = new Set(remapDemoTeams(surrogates));
  return remappedTeams.filter((team) => !surrogateSet.has(team));
}

/**
 * Builds one alliance's `OprObservation`, resolving how to treat a
 * surrogate's slot for the other teams.
 *
 * Treats the surrogate as a known quantity rather than an unknown: its
 * column never appears in the design matrix (via `ratingEligibleTeams`),
 * so it receives no rating update, but its contribution is not simply
 * thrown away either — its current rating at this event (or, if it has
 * none yet, this event's current league-mean per-team share as a
 * cold-start substitute) is subtracted from the target alliance score, so
 * its teammates keep a correctly-scaled observation instead of one
 * inflated by absorbing the surrogate's share.
 *
 * Disqualification policy is the opposite position from surrogates for a
 * partial disqualification, for the reason `ratingEligibleTeams` documents:
 * the column is kept and the rating is updated, except in the narrower
 * whole-alliance-zero-score case, which `update()` handles by never even
 * calling this function.
 */
export function allianceObservation(
  teams: readonly string[],
  surrogates: readonly string[],
  allianceScore: number,
  ratings: ReadonlyMap<string, number>,
  leagueMeanPerTeamShare: number
): OprObservation {
  const eligibleTeams = ratingEligibleTeams(teams, surrogates);
  // Defense-in-depth remap: `ratings` is keyed by whatever identity
  // `ratingEligibleTeams` produces, the remapped identity for a demo team,
  // so this lookup must use the same remapped key or it would silently
  // miss and fall back to `leagueMeanPerTeamShare` for a surrogate that
  // happens to be a demo key.
  const remappedSurrogates = remapDemoTeams(surrogates);
  const surrogateOffset = remappedSurrogates.reduce(
    (sum, team) => sum + (ratings.get(team) ?? leagueMeanPerTeamShare),
    0
  );
  return { teams: eligibleTeams, allianceScore: allianceScore - surrogateOffset };
}

/** This event's mean per-team-slot contribution, from this event only — cross-event data would leak season-wide info into a surrogate's offset. Cold-start substitute for a surrogate with no rating yet. */
function currentLeagueMeanPerTeamShare(
  observations: readonly OprObservation[],
  fallbackAllianceScore: number
): number {
  let totalScore = 0;
  let totalSlots = 0;
  for (const obs of observations) {
    totalScore += obs.allianceScore;
    totalSlots += obs.teams.length;
  }
  return totalSlots === 0 ? fallbackAllianceScore / 3 /* 3 teams per FRC alliance */ : totalScore / totalSlots;
}

function buildTeamIndex(observations: readonly OprObservation[]): Map<string, number> {
  const teamIndex = new Map<string, number>();
  for (const obs of observations) {
    for (const team of obs.teams) {
      if (!teamIndex.has(team)) teamIndex.set(team, teamIndex.size);
    }
  }
  return teamIndex;
}

/**
 * Minimum-norm least-squares OPR solve for one event: normal equations
 * `M^T M x = M^T s` via `SingularValueDecomposition` — no ridge, no
 * hand-rolled cutoff (`.solve()` already zeroes singular values at or below
 * its own relative `threshold`, matching `np.linalg.pinv`'s default).
 * Solving via `M^T M` rather than an SVD of the raw `M` is deliberate
 * fidelity to TBA's own `build_Minv_matrix`, which builds this same Gram
 * matrix and pseudo-inverts it — "improving" this would make our OPR a
 * different computation than TBA's.
 *
 * Demo-team handling: `obs.teams` can legitimately list the same team key
 * twice in one row (two demo robots on one alliance, both remapped to
 * `DEMO_PSEUDO_TEAM_KEY`). The column value is therefore accumulated
 * (`M.get(row, idx) + 1`), never overwritten to a flat `1` — a repeated key
 * correctly contributes coefficient 2, matching the alliance's real slot
 * count. Overwriting would silently under-count that row's equation for
 * every real team it shares a system of equations with.
 */
export function solveEventOpr(
  observations: readonly OprObservation[],
  teamIndex: ReadonlyMap<string, number>
): Map<string, number> {
  const ratings = new Map<string, number>();
  const n = teamIndex.size;
  if (n === 0 || observations.length === 0) return ratings;

  const M = Matrix.zeros(observations.length, n);
  const s = Matrix.columnVector(observations.map((o) => o.allianceScore));
  observations.forEach((obs, row) => {
    for (const team of obs.teams) {
      const idx = teamIndex.get(team);
      if (idx !== undefined) M.set(row, idx, M.get(row, idx) + 1);
    }
  });

  const MtM = M.transpose().mmul(M);
  const Mts = M.transpose().mmul(s);
  const x = new SingularValueDecomposition(MtM).solve(Mts);

  for (const [team, idx] of teamIndex) {
    ratings.set(team, x.get(idx, 0));
  }
  return ratings;
}

/** `scale` is always supplied by the caller from `OprState.allianceScoreStats` — there is no fixed default, because a fixed scale was the defect. */
function logisticWinProbability(scoreMargin: number, scale: number): number {
  return 1 / (1 + Math.exp(-scoreMargin / scale));
}

export const opr: AlgorithmModule<OprState> = {
  id: "opr",
  // Version bumps: no artifact may show one code version standing for two
  // structurally different algorithms. 3.1.0 dropped a whole-alliance
  // zero-score disqualification as a rating observation instead of fitting
  // it as real performance. 4.0.0 replaced the fixed logistic scale with
  // this season's expanding-window alliance-score SD, changing every win
  // probability this module has ever emitted and the state shape (see
  // `STATE_SNAPSHOT_SHAPE_VERSION` in `packages/harness/stateSnapshot.ts`).
  version: "4.0.0+baseline",

  initState(): OprState {
    return { perEvent: new Map(), lastEventByTeam: new Map(), allianceScoreStats: emptyExpandingStats() };
  },

  // No comp-level branch — every comp level is predicted and scored.
  predict(state: OprState, match: UpcomingMatch): Prediction {
    const eventRatings = state.perEvent.get(match.eventKey)?.ratings;
    const redTeams = ratingEligibleTeams(match.redTeams, match.redSurrogates);
    const blueTeams = ratingEligibleTeams(match.blueTeams, match.blueSurrogates);
    // Literal-zero cold start — a team with no observations yet at this
    // event predicts exactly 0 (the `?? 0` below).
    const redScore = redTeams.reduce((sum, team) => sum + (eventRatings?.get(team) ?? 0), 0);
    const blueScore = blueTeams.reduce((sum, team) => sum + (eventRatings?.get(team) ?? 0), 0);
    // Season-wide expanding SD, reflecting only matches already folded by
    // `update` (leak-free by construction), with a documented `count < 2`
    // fallback so an event's opening matches get a real scale rather than 0/NaN.
    const scale = standardDeviation(state.allianceScoreStats, OPR_FALLBACK_SCORE_SD) / OPR_SCALE_DIVISOR_K;
    const pRedWin = logisticWinProbability(redScore - blueScore, scale);
    // Validated at emission, before returning.
    assertValidPRedWin(pRedWin, `opr.predict (${match.matchKey})`);
    return {
      winner: pRedWin >= 0.5 ? "red" : "blue",
      pRedWin,
      redScore,
      blueScore,
    };
  },

  // Only quals feed the fit — playoff alliances are hand-selected, not a
  // random draw, so a non-"qm" match is a genuine update() no-op.
  update(state: OprState, result: MatchResult): OprState {
    if (result.compLevel !== "qm") return state;
    // A fully-demo alliance is a non-contest — a forfeit/no-show bucket or
    // an offseason bracket bye, not a real opponent. Checked against the
    // raw (pre-remap) team lists. The whole match is skipped, both
    // alliances' observations, because "a real alliance beating three
    // placeholders" carries no real information about that real alliance
    // either. This is a defensive no-op against today's corpus for OPR
    // specifically (every real occurrence is already at a non-"qm" comp
    // level); it is not redundant for EPA, which does fold every comp level.
    if (isFullyDemoAlliance(result.redTeams) || isFullyDemoAlliance(result.blueTeams)) return state;

    const eventKey = result.eventKey;
    const eventState: PerEventOprState = state.perEvent.get(eventKey) ?? { observations: [], ratings: new Map() };
    const fallbackAllianceScore = (result.redScore + result.blueScore) / 2;
    const meanShare = currentLeagueMeanPerTeamShare(eventState.observations, fallbackAllianceScore);
    const redObservation = allianceObservation(result.redTeams, result.redSurrogates, result.redScore, eventState.ratings, meanShare);
    const blueObservation = allianceObservation(result.blueTeams, result.blueSurrogates, result.blueScore, eventState.ratings, meanShare);

    // An alliance whose every rating-eligible team is disqualified and
    // whose raw recorded score (never `redObservation.allianceScore`,
    // already surrogate-offset-adjusted) is exactly 0 contributes no row —
    // the same treatment as an all-surrogate alliance below: nothing left
    // to attribute to any real teammate. Checked per-alliance, not
    // per-match like `isFullyDemoAlliance` above — the opposing alliance's
    // own score is still a genuine observation and must not be dropped.
    const redIsDqZero = isFullyDqZeroScoreAlliance(redObservation.teams, result.redDqs, result.redScore);
    const blueIsDqZero = isFullyDqZeroScoreAlliance(blueObservation.teams, result.blueDqs, result.blueScore);
    const redRow = redIsDqZero ? { teams: [], allianceScore: 0 } : redObservation;
    const blueRow = blueIsDqZero ? { teams: [], allianceScore: 0 } : blueObservation;

    // Fold both alliances' raw recorded scores into the season-wide
    // expanding SD that `predict` reads for its logistic scale, reusing the
    // same DQ predicates the rows above are built from — a whole-alliance-DQ
    // zero is a ruling, not an observed score, and folding it would drag
    // this season's scale toward zero for no real reason.
    //
    // Placement is load-bearing: the fold sits above the
    // `newRows.length === 0` early return, so that path returns the state
    // with the updated stats rather than the untouched `state`. An alliance
    // whose every slot was a surrogate produces no design-matrix row, but
    // its score was still genuinely observed and belongs in the scale.
    let allianceScoreStats = state.allianceScoreStats;
    if (!redIsDqZero) allianceScoreStats = foldObservation(allianceScoreStats, result.redScore);
    if (!blueIsDqZero) allianceScoreStats = foldObservation(allianceScoreStats, result.blueScore);

    // An alliance whose every listed team is a surrogate (or fully
    // disqualified with a zero score, per the DQ check above) contributes
    // no row; if both alliances end up empty, nothing to re-solve, but the
    // scores above have still been folded into the scale.
    const newRows = [redRow, blueRow].filter((obs) => obs.teams.length > 0);
    if (newRows.length === 0) return { ...state, allianceScoreStats };

    const observations = [...eventState.observations, ...newRows];
    const teamIndex = buildTeamIndex(observations);
    const ratings = solveEventOpr(observations, teamIndex);

    // Finiteness guard — throw loudly rather than fold a corrupt rating
    // into every later prediction here.
    for (const [team, rating] of ratings) {
      if (!Number.isFinite(rating)) {
        throw new Error(
          `opr: solveEventOpr produced a non-finite rating for team ${team} at event ${eventKey} ` +
            `(${observations.length} accumulated observations) — the run aborts rather than propagating ` +
            `a corrupt rating through the rest of this event.`
        );
      }
    }

    const nextPerEvent = new Map(state.perEvent);
    nextPerEvent.set(eventKey, { observations, ratings });

    // Track each team's most recent event explicitly — insertion order
    // records a team's first event, wrong for an interleaved stream.
    const touchedTeams = newRows.flatMap((obs) => obs.teams);
    let nextLastEventByTeam = state.lastEventByTeam;
    if (touchedTeams.length > 0) {
      const next = new Map(nextLastEventByTeam);
      for (const team of touchedTeams) next.set(team, eventKey);
      nextLastEventByTeam = next;
    }
    return { perEvent: nextPerEvent, lastEventByTeam: nextLastEventByTeam, allianceScoreStats };
  },

  // No-variance baseline, one `TOTAL_METRIC_KEY` value per team.
  // Headlines each team's most recent event via `lastEventByTeam`.
  teamMetrics(state: OprState, teams?: readonly string[]): TeamMetrics {
    const requestedTeams = teams ?? [...state.lastEventByTeam.keys()];
    const result: TeamMetrics = {};
    for (const team of requestedTeams) {
      const eventKey = state.lastEventByTeam.get(team);
      if (eventKey === undefined) continue;
      const rating = state.perEvent.get(eventKey)?.ratings.get(team);
      if (rating === undefined) continue;
      result[team] = { [TOTAL_METRIC_KEY]: { value: rating } };
    }
    return result;
  },
};
