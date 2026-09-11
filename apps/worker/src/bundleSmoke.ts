/**
 * Answers 04-RESEARCH.md's Assumption A1 BEFORE anything depends on it: does
 * `ml-matrix` (the linear-algebra dependency `packages/core/algorithms/
 * opr.ts` uses for its SVD solve) bundle and EXECUTE inside the actual
 * Workers runtime — not just under Node/Vitest, where `packages/core/
 * isomorphic.test.ts` only proves the import specifiers are clean, never
 * that the dependency's own transitive tree loads (Pitfall 5).
 *
 * NOT the Worker's entrypoint anymore (plan 04-06 pointed `wrangler.toml`'s
 * `main` at `src/scheduled.ts`, the real `scheduled()` orchestration) —
 * deliberately KEPT in the repo as a re-runnable bundle-smoke proof rather
 * than deleted, since Assumption A1 is exactly the kind of thing that could
 * silently regress on a future `ml-matrix`/dependency bump, and re-proving
 * it should cost re-pointing `main` here temporarily, not re-deriving this
 * whole fixture from scratch. This file's only job is to import the real
 * prediction code from `packages/core` (never a Worker-specific
 * reimplementation — that would violate D-14's shared-code equivalence
 * claim) and actually RUN it, once, on a `fetch` request.
 *
 * `opr.initState`/`opr.predict`/`opr.update` exercise `ml-matrix`'s
 * `SingularValueDecomposition` (opr.ts line 25) — this is now the SOLE
 * remaining proof of Assumption A1 in this file; do not assume a second
 * independent witness exists.
 *
 * PLAN 09-04 TASK 3: `analyticRpPmf` (`rankingPoints/analyticPmf.ts`)
 * replaces the deleted `rpPmfForMatch` (`rankingPoints/distribution.ts`,
 * whose Cholesky decomposition WAS this file's second `ml-matrix` witness).
 * The closed form has NO matrix dependency at all — it exercises no
 * `ml-matrix` code whatsoever — so this half of the smoke test no longer
 * proves Assumption A1. What it proves instead, and what makes it worth
 * keeping rather than deleting: it is the standing proof that the exact RP
 * pmf path plan 09-08 needs bundles and EXECUTES inside the real Workers
 * runtime, for a live event's `scheduled()` tick — arguably a MORE useful
 * proof for this project's next phase than the decomposition it replaces.
 */
import { opr } from "../../../packages/core/algorithms/opr.js";
import type { MatchResult, UpcomingMatch } from "../../../packages/core/algorithms/types.js";
import { analyticRpPmf } from "../../../packages/core/rankingPoints/analyticPmf.js";
import type { AllianceRpMoments } from "../../../packages/core/rankingPoints/moments.js";
import { rpRuleModuleForSeason } from "../../../packages/core/rankingPoints/rules.js";

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
  week: null,
};

const playedMatch: MatchResult = {
  ...upcomingMatch,
  winner: "red",
  // No disqualifications in this smoke fixture. Stated explicitly rather than
  // omitted: `isFullyDqZeroScoreAlliance` treats an absent DQ list and an empty
  // one identically (`new Set(undefined)` is a legal empty Set), so an omission
  // here would compile-fail loudly but read as harmless — which is exactly how
  // the same omission in `scheduled.ts`'s own `toMatchResult` went unnoticed.
  redDqs: [],
  blueDqs: [],
  redScore: 120,
  blueScore: 95,
  redRpEarned: null,
  blueRpEarned: null,
  hasScoreBreakdown: false,
  scoreBreakdownRaw: null,
};

/** A hand-built, DIAGONAL `AllianceRpMoments` fixture, zero cross-covariance — `analyticRpPmf`'s independence precondition (D-08) requires exactly this shape, and a real algorithm's own moments (e.g. `predictAllianceRpMoments`, `sigma1/rp/state.ts`) is a DIFFERENT thing this smoke test does not need; SOME valid moments are enough to prove the closed form runs inside the Workers runtime. */
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

  // --- analyticRpPmf: the closed-form RP pmf plan 09-08 needs to run in a
  // live Worker tick. No ml-matrix here (see file header) — this proves the
  // exact path bundles and executes, not the matrix dependency.
  const ruleModule = rpRuleModuleForSeason(2026);
  const variableNames = ruleModule.thresholdVariables.map((v) => v.name);
  const red = fixtureAllianceRpMoments(variableNames, 120, 400);
  const blue = fixtureAllianceRpMoments(variableNames, 95, 380);
  const { redPmf, bluePmf } = analyticRpPmf({
    red,
    blue,
    ruleModule,
    eventType: REGIONAL_EVENT_TYPE,
    compLevel: "qm",
    // 09-05's `config`/`pRedWin` arguments are GONE, not omitted: plan 09-06
    // measured every RP layer config against the pre-committed bar, accepted
    // none of them, and deleted the whole selectable surface along with the
    // branches it selected between. This call site was left passing both and
    // importing a deleted export, so this file — 09-04's standing proof that
    // the RP path bundles for the Workers runtime — did not typecheck at all.
    // Repaired by plan 09-08 (deviation Rule 3), which depends on that proof.
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
