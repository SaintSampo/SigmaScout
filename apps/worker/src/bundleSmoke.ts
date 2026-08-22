/**
 * Answers 04-RESEARCH.md's Assumption A1 BEFORE anything depends on it: does
 * `ml-matrix` (the linear-algebra dependency `packages/core/algorithms/
 * opr.ts` uses for its SVD solve and `sigma1/rp/distribution.ts` uses for its
 * Cholesky decomposition) bundle and EXECUTE inside the actual Workers
 * runtime — not just under Node/Vitest, where `packages/core/isomorphic
 * .test.ts` only proves the import specifiers are clean, never that the
 * dependency's own transitive tree loads (Pitfall 5).
 *
 * TEMPORARY entry point (see wrangler.toml's `main` comment) — plan 04-06
 * replaces this with the real `scheduled()` orchestration. This file's only
 * job is to import the real prediction code from `packages/core` (never a
 * Worker-specific reimplementation — that would violate D-14's shared-code
 * equivalence claim) and actually RUN it, once, on a `fetch` request.
 *
 * `opr.initState`/`opr.predict`/`opr.update` exercise `ml-matrix`'s
 * `SingularValueDecomposition` (opr.ts line 25); `rpPmfForMatch` exercises
 * `ml-matrix`'s `CholeskyDecomposition` (sigma1/rp/distribution.ts). Both
 * fixtures below are hand-built minimal data, not read from any real corpus
 * — this Worker never imports `better-sqlite3` or the corpus (that boundary
 * is what `packages/core/isomorphic.test.ts` already enforces).
 */
import { opr } from "../../../packages/core/algorithms/opr.js";
import type { MatchResult, UpcomingMatch } from "../../../packages/core/algorithms/types.js";
import { rpPmfForMatch } from "../../../packages/core/algorithms/sigma1/rp/distribution.js";
import type { AllianceRpMoments } from "../../../packages/core/algorithms/sigma1/rp/state.js";
import { rpRuleModuleForSeason } from "../../../packages/core/algorithms/sigma1/rp/rules.js";
import { DEFAULT_SIGMA1_PARAMS } from "../../../packages/core/algorithms/sigma1/params.js";

const EVENT_KEY = "2026testq";
const MATCH_KEY = "2026testq_qm1";
/** TBA event_type 0 = Regional — RP-eligible (`EVENT_TYPE_TIERS`, "base" tier). */
const REGIONAL_EVENT_TYPE = 0;

const upcomingMatch: UpcomingMatch = {
  matchKey: MATCH_KEY,
  eventKey: EVENT_KEY,
  compLevel: "qm",
  setNumber: 1,
  matchNumber: 1,
  redTeams: ["frc254", "frc111", "frc1114"],
  blueTeams: ["frc971", "frc2056", "frc1678"],
  redSurrogates: [],
  blueSurrogates: [],
  eventType: REGIONAL_EVENT_TYPE,
};

const playedMatch: MatchResult = {
  ...upcomingMatch,
  winner: "red",
  redScore: 120,
  blueScore: 95,
  redRpEarned: null,
  blueRpEarned: null,
  hasScoreBreakdown: false,
  scoreBreakdownRaw: null,
};

/** A hand-built, positive-definite `AllianceRpMoments` fixture — diagonal variance block, zero cross-covariance, so `rpPmfForMatch`'s Cholesky decomposition succeeds on the first (unridged) attempt. Real moments come from `predictAllianceRpMoments` (`rp/state.ts`); this smoke test only needs SOME valid moments to prove the decomposition runs inside the Workers runtime. */
function fixtureAllianceRpMoments(variableNames: readonly string[], scoreMean: number, scoreVariance: number): AllianceRpMoments {
  const T = variableNames.length;
  return {
    variableNames,
    meanVector: new Array(T).fill(1) as number[],
    varianceBlock: Array.from({ length: T }, (_, i) => Array.from({ length: T }, (_, j) => (i === j ? 5 : 0))),
    scoreMean,
    scoreVariance,
    scoreCrossCovariance: new Array(T).fill(0) as number[],
  };
}

interface BundleSmokeResult {
  readonly opr: {
    readonly initialPredictedProbability: number;
    readonly predictedProbabilityAfterUpdate: number;
    readonly redScoreAfterUpdate: number;
    readonly blueScoreAfterUpdate: number;
  };
  readonly rpDistribution: {
    readonly redPmfLength: number;
    readonly bluePmfLength: number;
    readonly redPmfSum: number;
    readonly bluePmfSum: number;
  };
}

function runBundleSmoke(): BundleSmokeResult {
  // --- opr: exercises ml-matrix's SingularValueDecomposition ---------------
  let state = opr.initState([...upcomingMatch.redTeams, ...upcomingMatch.blueTeams]);
  const initialPrediction = opr.predict(state, upcomingMatch);
  state = opr.update(state, playedMatch);
  const predictionAfterUpdate = opr.predict(state, upcomingMatch);

  // --- sigma1 RP distribution: exercises ml-matrix's CholeskyDecomposition -
  const ruleModule = rpRuleModuleForSeason(2026);
  const variableNames = ruleModule.thresholdVariables.map((v) => v.name);
  const red = fixtureAllianceRpMoments(variableNames, 120, 400);
  const blue = fixtureAllianceRpMoments(variableNames, 95, 380);
  const { redPmf, bluePmf } = rpPmfForMatch({
    red,
    blue,
    ruleModule,
    eventType: REGIONAL_EVENT_TYPE,
    matchKey: MATCH_KEY,
    compLevel: "qm",
    params: DEFAULT_SIGMA1_PARAMS,
  });

  return {
    opr: {
      initialPredictedProbability: initialPrediction.pRedWin,
      predictedProbabilityAfterUpdate: predictionAfterUpdate.pRedWin,
      redScoreAfterUpdate: predictionAfterUpdate.redScore,
      blueScoreAfterUpdate: predictionAfterUpdate.blueScore,
    },
    rpDistribution: {
      redPmfLength: redPmf.length,
      bluePmfLength: bluePmf.length,
      redPmfSum: redPmf.reduce((a, b) => a + b, 0),
      bluePmfSum: bluePmf.reduce((a, b) => a + b, 0),
    },
  };
}

export default {
  fetch(): Response {
    const result = runBundleSmoke();
    const allFinite =
      Number.isFinite(result.opr.initialPredictedProbability) &&
      Number.isFinite(result.opr.predictedProbabilityAfterUpdate) &&
      Number.isFinite(result.opr.redScoreAfterUpdate) &&
      Number.isFinite(result.opr.blueScoreAfterUpdate) &&
      result.rpDistribution.redPmfLength > 0 &&
      result.rpDistribution.bluePmfLength > 0;

    if (!allFinite) {
      return new Response(JSON.stringify({ ok: false, result }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
} satisfies ExportedHandler;
