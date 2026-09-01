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
 * / OPR_SCALE_DIVISOR_K`. Fitted on the TUNE seasons (2022-2024) only; the
 * 2025/2026 figures below are holdout.
 *
 * This replaces a fixed `OPR_LOGISTIC_SCALE = 10`, which had been in place
 * since 2022 and whose doc comment claimed 10 was "roughly one typical
 * alliance-score SD ... (margin=10 -> ~0.73)". That was the actual defect: the
 * per-season optimum is 19, 28, 21, 31, and 75 across 2022-2026. A fixed 10
 * was not one SD in any season, and by 2026 it was off by 7.5x — the model was
 * wildly overconfident on every margin it saw.
 *
 * Why not simply fit the constant per season: that is LEAKAGE. A per-season
 * optimum is chosen using the very outcomes it is then scored against, so it
 * cannot be computed at prediction time and its Brier is not an honest
 * estimate of anything. The expanding-window form is leak-free by construction
 * (Pitfall EPA-1, the same construction `epa.ts` uses): it only ever reflects
 * matches already passed to `update`.
 *
 * Measured Brier, fixed 10 -> expanding, against the LEAKY per-season ceiling:
 *   2022 tune    0.1890 -> 0.1812  (leaky ceiling 0.1810 @19)
 *   2023 tune    0.2171 -> 0.1962  (leaky ceiling 0.1963 @28)
 *   2024 tune    0.2126 -> 0.2011  (leaky ceiling 0.2012 @21)
 *   2025 holdout 0.2119 -> 0.1892  (leaky ceiling 0.1891 @31)
 *   2026 holdout 0.2211 -> 0.1795  (leaky ceiling 0.1796 @75)
 * It MATCHES OR BEATS the leaky ceiling in every season — because it also
 * adapts WITHIN a season, which a single per-season constant cannot — and
 * beats a prior-season constant everywhere. Brier improves 4.1%-18.8% overall;
 * elimination-only 2.6%-19.0%, except 2022 elims at -3.2%.
 *
 * What this does NOT fix: OPR's no-call rate. A no-call is a predicted margin
 * of exactly 0 (an event-scoped, quals-only design matrix has no rank at each
 * event's start), and `0 / scale === 0` for ANY scale, so those predictions
 * stay at exactly 0.5. Under D-Q3 they now count as misses. That is expected
 * and is not something this constant can address.
 */
export const OPR_SCALE_DIVISOR_K = 1.1;

/**
 * Scale numerator used until `allianceScoreStats` holds at least 2 folded
 * scores — with `count < 2` the Welford SD is undefined, and this keeps
 * `predict` from producing a 0 or NaN scale on an event's opening matches.
 *
 * Equal in value to `EPA_FALLBACK_SCORE_SD` in `epa.ts`, deliberately, since
 * both answer the same question ("what is a typical FRC alliance score SD
 * before we have measured one?"). It is declared here rather than imported
 * because `epa.ts` already imports `ratingEligibleTeams` from this module, so
 * importing back would create a module cycle — the same reasoning
 * `sigma1/params.ts`'s header records for its own duplicated constants.
 * `opr.test.ts` pins the two to equality so they cannot silently drift.
 */
export const OPR_FALLBACK_SCORE_SD = 25;

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
 * `eventKey`. `lastEventByTeam` (D-04): explicitly tracked. Map insertion
 * order alone would record a team's FIRST event, not its MOST RECENT one —
 * wrong once two events interleave — so this field is written explicitly on
 * every `update()` call instead.
 *
 * `allianceScoreStats` (D-Q4): the expanding-window Welford accumulator over
 * every alliance score folded so far, feeding `predict`'s logistic scale. Note
 * it is SEASON-wide even though OPR's ratings are strictly event-scoped, and
 * that asymmetry is deliberate: this is a LINK-FUNCTION scale (how many points
 * of margin constitute a confident prediction this year), not a rating, so
 * pooling it across a season's events is the right estimator and is what was
 * validated. No `carrySeason` is needed to bound it — `opr` implements none,
 * so `cli.ts`'s `runSeasons` starts OPR from `initState` every season (see its
 * doc comment, "deliberately left OUT of `initialStates`"), which gives
 * exactly the season-wide-but-not-cross-season scope wanted.
 */
export interface OprState {
  readonly perEvent: ReadonlyMap<string, PerEventOprState>;
  readonly lastEventByTeam: ReadonlyMap<string, string>;
  readonly allianceScoreStats: ExpandingStats;
}

/**
 * Teams whose column should appear in the design matrix for this alliance:
 * every listed team except surrogates. D-07 requires that a surrogate
 * appearance produce no rating update for the surrogate itself; excluding
 * its column here is how that is enforced (its contribution is still
 * accounted for — see `allianceObservation` — via a subtracted offset, not
 * simply discarded).
 *
 * Disqualification policy (Open Question 3, RESEARCH.md — narrowed by
 * `.planning/todos/pending/exclude-whole-alliance-dq-zero-scores.md`,
 * 2026-08-30; deliberately the OPPOSITE policy from surrogates for a
 * PARTIAL disqualification, see `allianceObservation` for the fuller
 * reasoning): a disqualified team physically played the match and
 * physically contributed to the alliance's score. A disqualification is a
 * ranking-and-record ruling, not a statement that the robot was absent, and
 * OPR models score contribution — so removing a disqualified team's column
 * would misattribute its real contribution to its teammates. A disqualified
 * team therefore still keeps its column here, and this function does NOT
 * filter individual DQ'd teams out of an otherwise-normal alliance. What
 * changed: `update()` below now drops the entire alliance observation (this
 * function is never even called for it) in the narrower case where EVERY
 * team on the alliance is disqualified AND TBA recorded the alliance's
 * score as 0 (`isFullyDqZeroScoreAlliance`, `dq.ts`) — there, the "real
 * contribution to misattribute" this comment describes does not exist; only
 * a 0 describing the ruling does. `MatchResult` now DOES carry
 * `redDqs`/`blueDqs` (added alongside this narrowing), populated end-to-end
 * from `red_dqs`/`blue_dqs` in the corpus.
 *
 * Demo-team handling (`.planning/todos/pending/exclude-offseason-demo-teams.md`,
 * `demoTeams.ts`): every demo key in `teams`/`surrogates` is remapped to the
 * shared `DEMO_PSEUDO_TEAM_KEY` BEFORE the surrogate filter runs — the
 * OPPOSITE treatment from surrogates. A surrogate's column is REMOVED (its
 * contribution subtracted as a known offset instead, see
 * `allianceObservation`); a demo team's column is KEPT, under a shared
 * identity, so the design matrix stays balanced and the demo robot's real
 * contribution to the alliance's real score is never silently reattributed
 * to its real teammates. This is the ONE choke point every one of this
 * project's three algorithms routes team identity through (`epa.ts`,
 * `sigma1/index.ts` both call this same function), so the remap applies
 * everywhere team eligibility is decided, without a second call site per
 * algorithm.
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
 * Disqualification policy (Open Question 3, RESEARCH.md — narrowed by
 * `.planning/todos/pending/exclude-whole-alliance-dq-zero-scores.md`,
 * 2026-08-30; this plan takes the opposite position from surrogates for a
 * PARTIAL disqualification and states why): a disqualified team physically
 * played the match and physically contributed to the alliance's score. A
 * disqualification is a ranking-and-record ruling, not a statement that
 * the robot was absent, and OPR models score contribution — so removing a
 * disqualified team's column would misattribute its real contribution to
 * its teammates. The column is kept here and the rating IS updated, the
 * opposite policy from surrogates — but only when the alliance is NOT the
 * narrower whole-alliance-DQ-with-zero-score case: `update()` below never
 * even calls this function for that case (`isFullyDqZeroScoreAlliance`,
 * `dq.ts`), since there the "real contribution to misattribute" this
 * comment describes does not exist — only a 0 describing the ruling does.
 */
export function allianceObservation(
  teams: readonly string[],
  surrogates: readonly string[],
  allianceScore: number,
  ratings: ReadonlyMap<string, number>,
  leagueMeanPerTeamShare: number
): OprObservation {
  const eligibleTeams = ratingEligibleTeams(teams, surrogates);
  // Defense-in-depth remap (surrogates are, in practice, never also demo
  // teams — but `ratings` is keyed by whatever identity `ratingEligibleTeams`
  // produces, which is the REMAPPED identity for a demo team, so this lookup
  // must use the same remapped key or it would silently miss and fall back
  // to `leagueMeanPerTeamShare` for a surrogate that happens to be a demo key.
  const remappedSurrogates = remapDemoTeams(surrogates);
  const surrogateOffset = remappedSurrogates.reduce(
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
 * Minimum-norm least-squares OPR solve for one event (D-06): normal
 * equations `M^T M x = M^T s` via `SingularValueDecomposition` — no ridge,
 * no hand-rolled cutoff (`.solve()` already zeroes singular values at or
 * below its own relative `threshold`, matching `np.linalg.pinv`'s default).
 * Solving via `M^T M` rather than an SVD of the raw `M` is a DELIBERATE
 * fidelity choice — it squares the effective condition number, but TBA's
 * own `build_Minv_matrix` builds this same Gram matrix and pseudo-inverts
 * it; "improving" this would make our OPR a different computation than
 * TBA's.
 *
 * Demo-team handling (`demoTeams.ts`): `obs.teams` can legitimately list the
 * SAME team key twice in one row (two demo robots on one alliance, both
 * remapped to `DEMO_PSEUDO_TEAM_KEY` — measured directly against the real
 * corpus: not a rare case). The column value is therefore ACCUMULATED
 * (`M.get(row, idx) + 1`), never overwritten to a flat `1` — a repeated key
 * correctly contributes coefficient 2 to that row, matching what the
 * alliance's real slot count actually was. Overwriting instead would
 * silently under-count that row's design-matrix equation for every ordinary
 * real team it shares a system of equations with, a bias this fix closes
 * rather than accepts.
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

/** D-Q4: `scale` is now always supplied by the caller from `OprState.allianceScoreStats` — there is no fixed default, because a fixed scale was the defect. */
function logisticWinProbability(scoreMargin: number, scale: number): number {
  return 1 / (1 + Math.exp(-scoreMargin / scale));
}

export const opr: AlgorithmModule<OprState> = {
  id: "opr",
  // Bumped 2.0.0 -> 3.0.0 (D-13's version-identity scheme): no artifact may
  // show one code version standing for two structurally different algorithms.
  // Bumped again 3.0.0 -> 3.1.0
  // (`.planning/todos/pending/exclude-whole-alliance-dq-zero-scores.md`,
  // 2026-08-30): `update()`'s observable output changed — a whole-alliance
  // disqualification with a recorded 0 score is now dropped as a rating
  // observation instead of fitted as real performance
  // (`isFullyDqZeroScoreAlliance`, `dq.ts`), the same D-13 invariant this
  // comment already names.
  // Bumped again 3.1.0 -> 4.0.0 (D-Q4, quick task 260901-is2): both
  // `predict()`'s and `update()`'s observable output changed — the logistic
  // scale is no longer the fixed `OPR_LOGISTIC_SCALE = 10` but this season's
  // expanding-window alliance-score SD over `OPR_SCALE_DIVISOR_K`, and
  // `OprState` gained `allianceScoreStats` to carry it. MAJOR because every
  // win probability this module has ever emitted moves (the per-season optimum
  // ranged 19-75 against the retired constant's 10), and because the state
  // shape changed — see `STATE_SNAPSHOT_SHAPE_VERSION` in
  // `packages/harness/stateSnapshot.ts`, bumped 2 -> 3 in the same commit.
  version: "4.0.0+baseline",

  initState(): OprState {
    return { perEvent: new Map(), lastEventByTeam: new Map(), allianceScoreStats: emptyExpandingStats() };
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
    // D-Q4: season-wide expanding SD, reflecting ONLY matches already folded
    // by `update` (leak-free by construction), with a documented `count < 2`
    // fallback so an event's opening matches get a real scale rather than 0/NaN.
    const scale = standardDeviation(state.allianceScoreStats, OPR_FALLBACK_SCORE_SD) / OPR_SCALE_DIVISOR_K;
    const pRedWin = logisticWinProbability(redScore - blueScore, scale);
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
    // Case 1 (`demoTeams.ts`): a fully-demo alliance is a non-contest — a
    // forfeit/no-show bucket or an offseason bracket bye, not a real
    // opponent. Checked against the RAW (pre-remap) team lists, since
    // remapping would collapse a fully-demo alliance into repeated pseudo
    // entries that `isFullyDemoAlliance` would need to see through anyway.
    // The WHOLE MATCH is skipped — both alliances' observations, not just
    // the demo side's — because "a real alliance beating three placeholders"
    // carries no real information about that real alliance either. Measured:
    // every real-event (non-offseason) occurrence of this is already at a
    // non-"qm" comp level, so this line is a defensive no-op against today's
    // corpus for OPR specifically; it is NOT redundant for EPA/Sigma1, which
    // (unlike OPR) do fold every comp level, including the 195 fully-demo
    // `qm` rows this corpus carries at offseason events.
    if (isFullyDemoAlliance(result.redTeams) || isFullyDemoAlliance(result.blueTeams)) return state;

    const eventKey = result.eventKey;
    const eventState: PerEventOprState = state.perEvent.get(eventKey) ?? { observations: [], ratings: new Map() };
    const fallbackAllianceScore = (result.redScore + result.blueScore) / 2;
    const meanShare = currentLeagueMeanPerTeamShare(eventState.observations, fallbackAllianceScore);
    const redObservation = allianceObservation(result.redTeams, result.redSurrogates, result.redScore, eventState.ratings, meanShare);
    const blueObservation = allianceObservation(result.blueTeams, result.blueSurrogates, result.blueScore, eventState.ratings, meanShare);

    // `.planning/todos/pending/exclude-whole-alliance-dq-zero-scores.md`:
    // an alliance whose every rating-eligible team is disqualified AND whose
    // RAW recorded score (never `redObservation.allianceScore`, which is
    // already surrogate-offset-adjusted) is exactly 0 contributes no row —
    // the same treatment as an all-surrogate alliance below, and for the
    // same reason: nothing left to attribute to any real teammate. Checked
    // per-alliance, NOT per-match like `isFullyDemoAlliance` above — the
    // opposing alliance's own score is still a genuine observation of real
    // robots and must not be dropped just because this alliance's own
    // ruling zeroed its score.
    const redIsDqZero = isFullyDqZeroScoreAlliance(redObservation.teams, result.redDqs, result.redScore);
    const blueIsDqZero = isFullyDqZeroScoreAlliance(blueObservation.teams, result.blueDqs, result.blueScore);
    const redRow = redIsDqZero ? { teams: [], allianceScore: 0 } : redObservation;
    const blueRow = blueIsDqZero ? { teams: [], allianceScore: 0 } : blueObservation;

    // D-Q4: fold both alliances' RAW recorded scores into the season-wide
    // expanding SD that `predict` reads for its logistic scale, reusing the
    // very same DQ predicates the rows above are built from — a
    // whole-alliance-DQ zero is a ruling, not an observed score, and folding
    // it would drag this season's scale toward zero for no real reason
    // (the identical `dq.ts` exclusion `epa.ts` and `sigma1/index.ts` apply).
    //
    // Placement is load-bearing, and this is the mistake to avoid: the fold
    // sits ABOVE the `newRows.length === 0` early return, and that path
    // returns the state WITH the updated stats rather than the untouched
    // `state`. An alliance whose every slot was a surrogate produces no
    // design-matrix row, but its score was still genuinely observed and
    // belongs in the scale. Dropping it there would make the scale silently
    // depend on surrogate scheduling.
    let allianceScoreStats = state.allianceScoreStats;
    if (!redIsDqZero) allianceScoreStats = foldObservation(allianceScoreStats, result.redScore);
    if (!blueIsDqZero) allianceScoreStats = foldObservation(allianceScoreStats, result.blueScore);

    // An alliance whose every listed team is a surrogate (or, per the DQ
    // check just above, fully disqualified with a zero score) contributes no
    // row (filtered here, not pushed in as an all-zero row); if both
    // alliances end up empty, nothing to re-solve — no rating changes, but
    // the scores above have still been folded into the scale.
    const newRows = [redRow, blueRow].filter((obs) => obs.teams.length > 0);
    if (newRows.length === 0) return { ...state, allianceScoreStats };

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
    return { perEvent: nextPerEvent, lastEventByTeam: nextLastEventByTeam, allianceScoreStats };
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
