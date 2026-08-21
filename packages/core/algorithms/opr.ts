/**
 * OPR (Offensive Power Rating) baseline — a no-variance AlgorithmModule.
 *
 * Event-scoped, quals-only, no-ridge rewrite (Phase 3.2, D-01/D-02/D-03/D-05/
 * D-06) — TBA's own definition: a fit over ONE event's qualification
 * matches, a plain minimum-norm pseudo-inverse (verified against
 * `matchstats_helper.py`'s `build_Minv_matrix`: filters to `comp_level ==
 * "qm"`, calls bare `np.linalg.pinv(M)`, no ridge anywhere).
 *
 * WHY no penalty term (D-06): season pooling let a team accumulate ~30-40
 * observations by mid-season, so `lambda=3`'s bias stayed a small ~7-9%.
 * Event scope with quals only finishes a regional at ~12 observations — the
 * SAME lambda would shrink ratings by ~20%, far more early on. Freezing it
 * would triple its effect while calling it unchanged. Rank deficiency
 * becomes a well-defined minimum-norm answer once the term is gone.
 *
 * WHY state is keyed by event, not reset (D-01): `replay.ts`'s
 * `buildSeasonStream` interleaves concurrent events in one chronological
 * stream — resetting on every `eventKey` change would corrupt every
 * simultaneously-running event. State is partitioned by `eventKey` instead.
 *
 * Surrogate (D-07) / disqualification (Open Question 3) handling below is
 * UNCHANGED and orthogonal to the event-scope change — see their comments.
 */
import { Matrix, SingularValueDecomposition } from "ml-matrix";
import { TOTAL_METRIC_KEY, type AlgorithmModule, type MatchResult, type Prediction, type TeamMetrics, type UpcomingMatch } from "./types.js";
import { assertValidPRedWin } from "../scoring/predictionValidity.js";

/**
 * Logistic scale converting a predicted score margin into a red-win
 * probability: pRedWin = 1 / (1 + exp(-margin / OPR_LOGISTIC_SCALE)). Chosen
 * so a margin of roughly one typical alliance-score SD (tens of points
 * across 2022-2026) maps to a confident-but-unsaturated probability
 * (margin=10 -> ~0.73).
 */
export const OPR_LOGISTIC_SCALE = 10;

/** One alliance's rating-eligible observation: teams' columns (a 1 in the design matrix row) and the target score, adjusted for any surrogate offset (see `allianceObservation`). */
export interface OprObservation {
  readonly teams: readonly string[];
  readonly allianceScore: number;
}

/** One event's accumulated quals-only observations and current solved ratings (D-01). Module-private — only the outer `OprState.perEvent` map needs to name this shape. */
interface PerEventOprState {
  readonly observations: readonly OprObservation[];
  readonly ratings: ReadonlyMap<string, number>;
}

/**
 * `perEvent` (D-01): every event accumulated independently, keyed by
 * `eventKey`. `lastEventByTeam` (D-04): explicitly tracked, not inferred
 * from insertion order — a team's FIRST event, not its MOST RECENT one.
 */
export interface OprState {
  readonly perEvent: ReadonlyMap<string, PerEventOprState>;
  readonly lastEventByTeam: ReadonlyMap<string, string>;
}

/**
 * Teams whose column should appear in the design matrix for this alliance:
 * every listed team except surrogates. D-07 requires that a surrogate
 * appearance produce no rating update for the surrogate itself; excluding
 * its column here is how that is enforced (its contribution is still
 * accounted for — see `allianceObservation` — via a subtracted offset, not
 * simply discarded).
 *
 * Disqualification policy (Open Question 3, RESEARCH.md — no locked
 * decision covers this; deliberately the OPPOSITE policy from surrogates,
 * see `allianceObservation` for the fuller reasoning): a disqualified team
 * physically played the match and physically contributed to the alliance's
 * score. A disqualification is a ranking-and-record ruling, not a
 * statement that the robot was absent, and OPR models score contribution —
 * so removing a disqualified team's column would misattribute its real
 * contribution to its teammates. Disqualified teams are therefore
 * deliberately NOT filtered here: `MatchResult` carries no dq field at all,
 * by design, so a disqualified team is indistinguishable from any other
 * participant to this function and keeps its column, with its rating
 * updated, exactly like a normal player. Plan 03 stores
 * `red_dqs`/`blue_dqs` in the corpus regardless, so reversing this call
 * later is a one-line addition to this function's signature, not a data
 * problem.
 */
export function ratingEligibleTeams(
  teams: readonly string[],
  surrogates: readonly string[]
): string[] {
  if (surrogates.length === 0) return [...teams];
  const surrogateSet = new Set(surrogates);
  return teams.filter((team) => !surrogateSet.has(team));
}

/**
 * Builds one alliance's `OprObservation`, resolving the modeling question
 * D-07 explicitly leaves open (how to treat a surrogate's slot in the
 * alliance observation for the other five teams).
 *
 * Approach: treat the surrogate as a known quantity rather than an
 * unknown. Its column never appears in the design matrix (via
 * `ratingEligibleTeams`), so it receives no rating update — exactly what
 * D-07 requires. Its contribution to the alliance's actual score is not
 * simply thrown away (which would discard real information about its two
 * or three non-surrogate teammates) nor left in the design matrix (which
 * would update its rating in violation of D-07) — instead its current
 * rating at THIS event (or, if it has none yet, this event's current
 * league-mean per-team share, as a cold-start substitute) is subtracted
 * from the target alliance score, so its teammates keep a correctly-scaled
 * observation instead of one inflated by absorbing the surrogate's share.
 *
 * Disqualification policy (Open Question 3, RESEARCH.md — no locked
 * decision covers this; this plan takes the opposite position from
 * surrogates and states why): a disqualified team physically played the
 * match and physically contributed to the alliance's score. A
 * disqualification is a ranking-and-record ruling, not a statement that
 * the robot was absent, and OPR models score contribution — so removing a
 * disqualified team's column would misattribute its real contribution to
 * its teammates. The column is kept and the rating IS updated, the
 * opposite policy from surrogates. Concretely, `MatchResult` carries no dq
 * field at all, so there is nothing to special-case here; Plan 03 already
 * stores `red_dqs`/`blue_dqs` in the corpus regardless, so reversing this
 * call later is a one-line addition to this function's signature, not a
 * data problem.
 */
export function allianceObservation(
  teams: readonly string[],
  surrogates: readonly string[],
  allianceScore: number,
  ratings: ReadonlyMap<string, number>,
  leagueMeanPerTeamShare: number
): OprObservation {
  const eligibleTeams = ratingEligibleTeams(teams, surrogates);
  const surrogateOffset = surrogates.reduce(
    (sum, team) => sum + (ratings.get(team) ?? leagueMeanPerTeamShare),
    0
  );
  return { teams: eligibleTeams, allianceScore: allianceScore - surrogateOffset };
}

/** This event's mean per-team-slot contribution, from THIS EVENT ONLY (D-02: cross-event data would leak season-wide info into a surrogate's offset). Cold-start substitute for a surrogate with no rating yet. */
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
  return totalSlots === 0 ? fallbackAllianceScore / 3 : totalScore / totalSlots;
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
 * Minimum-norm least-squares OPR solve for one event (D-06): normal
 * equations `M^T M x = M^T s` via `SingularValueDecomposition` — no ridge,
 * no hand-rolled cutoff (`.solve()` already zeroes singular values at or
 * below its own relative `threshold`, matching `np.linalg.pinv`'s default).
 * Solving via `M^T M` rather than an SVD of the raw `M` is a DELIBERATE
 * fidelity choice — it squares the effective condition number, but TBA's
 * own `build_Minv_matrix` builds this same Gram matrix and pseudo-inverts
 * it; "improving" this would make our OPR a different computation than
 * TBA's.
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
      if (idx !== undefined) M.set(row, idx, 1);
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

function logisticWinProbability(scoreMargin: number, scale: number = OPR_LOGISTIC_SCALE): number {
  return 1 / (1 + Math.exp(-scoreMargin / scale));
}

export const opr: AlgorithmModule<OprState> = {
  id: "opr",
  // Bumped 2.0.0 -> 3.0.0 (D-13's version-identity scheme): no artifact may
  // show one code version standing for two structurally different algorithms.
  version: "3.0.0+baseline",

  initState(): OprState {
    return { perEvent: new Map(), lastEventByTeam: new Map() };
  },

  // D-05: no comp-level branch — every comp level is predicted and scored.
  predict(state: OprState, match: UpcomingMatch): Prediction {
    const eventRatings = state.perEvent.get(match.eventKey)?.ratings;
    const redTeams = ratingEligibleTeams(match.redTeams, match.redSurrogates);
    const blueTeams = ratingEligibleTeams(match.blueTeams, match.blueSurrogates);
    // D-02: literal-zero cold start — a team with no observations yet at
    // this event predicts exactly 0 (the `?? 0` below).
    const redScore = redTeams.reduce((sum, team) => sum + (eventRatings?.get(team) ?? 0), 0);
    const blueScore = blueTeams.reduce((sum, team) => sum + (eventRatings?.get(team) ?? 0), 0);
    const pRedWin = logisticWinProbability(redScore - blueScore);
    // 01-REVIEW WR-05 / D-05: validated at emission, before returning.
    assertValidPRedWin(pRedWin, `opr.predict (${match.matchKey})`);
    return {
      winner: pRedWin >= 0.5 ? "red" : "blue",
      pRedWin,
      redScore,
      blueScore,
    };
  },

  // D-05: only quals feed the fit — playoff alliances are hand-selected,
  // not a random draw, so a non-"qm" match is a genuine update() no-op.
  update(state: OprState, result: MatchResult): OprState {
    if (result.compLevel !== "qm") return state;

    const eventKey = result.eventKey;
    const eventState: PerEventOprState = state.perEvent.get(eventKey) ?? { observations: [], ratings: new Map() };
    const fallbackAllianceScore = (result.redScore + result.blueScore) / 2;
    const meanShare = currentLeagueMeanPerTeamShare(eventState.observations, fallbackAllianceScore);
    const redObservation = allianceObservation(result.redTeams, result.redSurrogates, result.redScore, eventState.ratings, meanShare);
    const blueObservation = allianceObservation(result.blueTeams, result.blueSurrogates, result.blueScore, eventState.ratings, meanShare);

    // An alliance whose every listed team is a surrogate contributes no row
    // (filtered here, not pushed in as an all-zero row); if both alliances
    // were fully surrogate, nothing to re-solve — a genuine no-op.
    const newRows = [redObservation, blueObservation].filter((obs) => obs.teams.length > 0);
    if (newRows.length === 0) return state;

    const observations = [...eventState.observations, ...newRows];
    const teamIndex = buildTeamIndex(observations);
    const ratings = solveEventOpr(observations, teamIndex);

    // 01-REVIEW WR-01 / D-03: surviving finiteness guard — throw loudly
    // rather than fold a corrupt rating into every later prediction here.
    for (const [team, rating] of ratings) {
      if (!Number.isFinite(rating)) {
        throw new Error(
          `opr: solveEventOpr produced a non-finite rating for team ${team} at event ${eventKey} ` +
            `(${observations.length} accumulated observations) — the run aborts rather than propagating ` +
            `a corrupt rating through the rest of this event (01-REVIEW WR-01, D-03).`
        );
      }
    }

    const nextPerEvent = new Map(state.perEvent);
    nextPerEvent.set(eventKey, { observations, ratings });

    // D-04: track each team's MOST RECENT event explicitly — insertion
    // order records a team's FIRST event, wrong for an interleaved stream.
    const touchedTeams = newRows.flatMap((obs) => obs.teams);
    let nextLastEventByTeam = state.lastEventByTeam;
    if (touchedTeams.length > 0) {
      const next = new Map(nextLastEventByTeam);
      for (const team of touchedTeams) next.set(team, eventKey);
      nextLastEventByTeam = next;
    }
    return { perEvent: nextPerEvent, lastEventByTeam: nextLastEventByTeam };
  },

  // D-27: no-variance baseline, one `TOTAL_METRIC_KEY` value per team. D-04:
  // headlines each team's MOST RECENT event via `lastEventByTeam`.
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
