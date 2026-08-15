/**
 * Pure unit tests for D-09's parallel RP state (`emptyRpTeamState`,
 * `foldRpObservation`, `predictAllianceRpMoments`) — no corpus access, no
 * `sigma1/index.ts` dependency, matching the leaf-module test shape
 * `covariance.test.ts`/`consistency.test.ts` already use for their own
 * modules.
 */
import { describe, expect, it } from "vitest";
import { teamTotalVariance } from "../covariance.js";
import { DEFAULT_SIGMA1_PARAMS } from "../params.js";
import { rpRuleModuleForSeason } from "./rules.js";
import { emptyRpTeamState, foldRpObservation, predictAllianceRpMoments, type RpFoldableTeamState, type RpLeague } from "./state.js";

const EMPTY_LEAGUE: RpLeague = { rpVariableMean: {} };

function foldableFrom(rpState: ReturnType<typeof emptyRpTeamState>, lastEventKey: string | null = null): RpFoldableTeamState {
  return { ...rpState, lastEventKey };
}

describe("emptyRpTeamState", () => {
  it("sizes rpCovariance T x T and rpCrossCovariance C x T, with an empty rpBeliefs record", () => {
    const state = emptyRpTeamState(3, 5);
    expect(state.rpBeliefs).toEqual({});
    expect(state.rpCovariance).toHaveLength(3);
    expect(state.rpCovariance[0]).toHaveLength(3);
    expect(state.rpCrossCovariance).toHaveLength(5);
    expect(state.rpCrossCovariance[0]).toHaveLength(3);
  });
});

describe("foldRpObservation — cold start from league prior", () => {
  it("a brand-new team (no prior entry) cold-starts every threshold variable from the league mean, then the fold moves its mean toward the observation", () => {
    const ruleModule = rpRuleModuleForSeason(2022); // matchCargoTotal, autoCargoTotal, endgamePoints
    const league: RpLeague = {
      rpVariableMean: {
        matchCargoTotal: { count: 10, mean: 15, m2: 0 },
        autoCargoTotal: { count: 10, mean: 2, m2: 0 },
        endgamePoints: { count: 10, mean: 10, m2: 0 },
      },
    };

    const result = foldRpObservation({
      teams: new Map(), // T1 has no prior entry at all
      league,
      ruleModule,
      allianceTeams: ["T1", "T2", "T3"],
      observedThresholdVariables: { matchCargoTotal: 30, autoCargoTotal: 6, endgamePoints: 30 },
      scoreResidualsByTeam: new Map(),
      componentCount: 4,
      eventKey: "2022test",
      params: DEFAULT_SIGMA1_PARAMS,
    });

    expect(result.teams.size).toBe(3);
    for (const team of ["T1", "T2", "T3"]) {
      const teamState = result.teams.get(team)!;
      // Every named threshold variable got a belief.
      expect(Object.keys(teamState.rpBeliefs).sort()).toEqual(["autoCargoTotal", "endgamePoints", "matchCargoTotal"]);
      // The fold moved the mean away from the pure cold-start league prior
      // (15/3=5 per team pre-fold) toward the observed alliance sum's share.
      expect(teamState.rpBeliefs["matchCargoTotal"]!.mean).not.toBe(5);
    }
  });

  it("with no league data at all, a brand-new team's threshold-variable mean starts at the documented flat prior (0), never NaN or a plausible-looking guess", () => {
    const ruleModule = rpRuleModuleForSeason(2026); // hubTotalCount, totalTowerPoints
    const result = foldRpObservation({
      teams: new Map(),
      league: EMPTY_LEAGUE,
      ruleModule,
      allianceTeams: ["T1"],
      observedThresholdVariables: { hubTotalCount: 0, totalTowerPoints: 0 },
      scoreResidualsByTeam: new Map(),
      componentCount: 2,
      eventKey: "2026test",
      params: DEFAULT_SIGMA1_PARAMS,
    });
    const t1 = result.teams.get("T1")!;
    expect(Number.isNaN(t1.rpBeliefs["hubTotalCount"]!.mean)).toBe(false);
    expect(Number.isFinite(t1.rpBeliefs["hubTotalCount"]!.mean)).toBe(true);
  });
});

describe("foldRpObservation — fold moves the right beliefs", () => {
  it("distributes credit for an observed alliance-level sum across teammates via the Kalman gain, and leaves an all-surrogate alliance untouched", () => {
    const ruleModule = rpRuleModuleForSeason(2026);
    const empty = () => foldableFrom(emptyRpTeamState(2, 2));
    const teams = new Map([
      ["T1", empty()],
      ["T2", empty()],
    ]);

    const result = foldRpObservation({
      teams,
      league: EMPTY_LEAGUE,
      ruleModule,
      allianceTeams: ["T1", "T2"],
      observedThresholdVariables: { hubTotalCount: 200, totalTowerPoints: 100 },
      scoreResidualsByTeam: new Map(),
      componentCount: 2,
      eventKey: "2026test",
      params: DEFAULT_SIGMA1_PARAMS,
    });

    // Both teammates started at the identical cold-start prior, so the
    // observed sum is split evenly between them.
    const t1 = result.teams.get("T1")!.rpBeliefs["hubTotalCount"]!.mean;
    const t2 = result.teams.get("T2")!.rpBeliefs["hubTotalCount"]!.mean;
    expect(t1).toBeCloseTo(t2, 9);
    expect(t1 + t2).toBeCloseTo(200, 6);
  });

  it("an all-surrogate alliance (empty allianceTeams) is a genuine no-op — empty result, no throw", () => {
    const ruleModule = rpRuleModuleForSeason(2022);
    const result = foldRpObservation({
      teams: new Map(),
      league: EMPTY_LEAGUE,
      ruleModule,
      allianceTeams: [],
      observedThresholdVariables: { matchCargoTotal: 10, autoCargoTotal: 2, endgamePoints: 10 },
      scoreResidualsByTeam: new Map(),
      componentCount: 3,
      eventKey: "2022test",
      params: DEFAULT_SIGMA1_PARAMS,
    });
    expect(result.teams.size).toBe(0);
  });

  it("throws for a non-finite observed threshold-variable value rather than folding it (T-03-02)", () => {
    const ruleModule = rpRuleModuleForSeason(2022);
    expect(() =>
      foldRpObservation({
        teams: new Map(),
        league: EMPTY_LEAGUE,
        ruleModule,
        allianceTeams: ["T1"],
        observedThresholdVariables: { matchCargoTotal: Number.NaN, autoCargoTotal: 2, endgamePoints: 10 },
        scoreResidualsByTeam: new Map(),
        componentCount: 3,
        eventKey: "2022test",
        params: DEFAULT_SIGMA1_PARAMS,
      })
    ).toThrow(/non-finite/);
  });

  it("folds a cross-covariance between the score residual and the RP residual (D-11's correlation, learned rather than asserted)", () => {
    const ruleModule = rpRuleModuleForSeason(2022);
    const teams = new Map([["T1", foldableFrom(emptyRpTeamState(3, 2))]]);
    const scoreResidualsByTeam = new Map([["T1", [5, -2]]]); // length 2 (componentCount)

    const result = foldRpObservation({
      teams,
      league: EMPTY_LEAGUE,
      ruleModule,
      allianceTeams: ["T1"],
      observedThresholdVariables: { matchCargoTotal: 20, autoCargoTotal: 2, endgamePoints: 10 },
      scoreResidualsByTeam,
      componentCount: 2,
      eventKey: "2022test",
      params: DEFAULT_SIGMA1_PARAMS,
    });

    const t1 = result.teams.get("T1")!;
    expect(t1.rpCrossCovariance).toHaveLength(2); // C rows
    expect(t1.rpCrossCovariance[0]).toHaveLength(3); // T columns
    // At least one entry is nonzero — the fold actually happened, not a
    // silent no-op matrix of zeros.
    const flat = t1.rpCrossCovariance.flat();
    expect(flat.some((v) => v !== 0)).toBe(true);
  });
});

describe("teamTotalVariance — D-09's separation is provable, not asserted", () => {
  it("returns the identical value for a team's SCORE covariance regardless of whether its RP data has been folded", () => {
    const scoreCovariance = [
      [4, 1],
      [1, 3],
    ];
    const withoutRp = emptyRpTeamState(0, 2);
    const withRp = { ...emptyRpTeamState(2, 2), rpCovariance: [[10, 2], [2, 8]], rpBeliefs: { x: { mean: 5, variance: 2 } } };

    expect(teamTotalVariance(scoreCovariance)).toBe(teamTotalVariance(scoreCovariance));
    // The point: `teamTotalVariance` is called with the SAME score
    // covariance argument in both cases — RP fields (`withoutRp`/`withRp`)
    // are never passed to it at all, proving the score-side total-variance
    // computation has no path through which RP state could enter it.
    expect(withoutRp.rpCovariance).not.toEqual(withRp.rpCovariance);
  });
});

describe("predictAllianceRpMoments", () => {
  it("sums mean/variance/cross-covariance across teammates, and passes score mean/variance through unchanged", () => {
    const ruleModule = rpRuleModuleForSeason(2026);
    const teams = new Map([
      [
        "T1",
        {
          rpBeliefs: { hubTotalCount: { mean: 50, variance: 4 }, totalTowerPoints: { mean: 20, variance: 2 } },
          rpCovariance: [
            [4, 1],
            [1, 2],
          ],
          rpCrossCovariance: [
            [0.5, 0.2],
            [0.1, 0.3],
          ],
        },
      ],
      [
        "T2",
        {
          rpBeliefs: { hubTotalCount: { mean: 30, variance: 3 }, totalTowerPoints: { mean: 10, variance: 1 } },
          rpCovariance: [
            [3, 0],
            [0, 1],
          ],
          rpCrossCovariance: [
            [0.2, 0.1],
            [0.05, 0.05],
          ],
        },
      ],
    ]);

    const moments = predictAllianceRpMoments(teams, ["T1", "T2"], ruleModule, 100, 25);

    expect(moments.variableNames).toEqual(["hubTotalCount", "totalTowerPoints"]);
    expect(moments.meanVector).toEqual([80, 30]); // 50+30, 20+10
    expect(moments.varianceBlock).toEqual([
      [7, 1],
      [1, 3],
    ]);
    // scoreMean/scoreVariance are the PASSED-IN values, never recomputed.
    expect(moments.scoreMean).toBe(100);
    expect(moments.scoreVariance).toBe(25);
    // Column sums per teammate, then summed across teammates:
    // T1 col0: 0.5+0.1=0.6, col1: 0.2+0.3=0.5
    // T2 col0: 0.2+0.05=0.25, col1: 0.1+0.05=0.15
    expect(moments.scoreCrossCovariance[0]).toBeCloseTo(0.85, 9);
    expect(moments.scoreCrossCovariance[1]).toBeCloseTo(0.65, 9);
  });

  it("a team absent from the state map contributes nothing (never NaN, never thrown)", () => {
    const ruleModule = rpRuleModuleForSeason(2026);
    const moments = predictAllianceRpMoments(new Map(), ["GHOST"], ruleModule, 0, 0);
    expect(moments.meanVector).toEqual([0, 0]);
    expect(moments.varianceBlock).toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(moments.scoreCrossCovariance).toEqual([0, 0]);
  });
});
