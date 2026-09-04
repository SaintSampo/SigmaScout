/**
 * Pure unit tests over the joint search's own logic (`tune.ts`'s
 * `determineWinner`, candidate generation, and the objective's
 * accuracy-blindness) — no corpus, matching the plan's stated scope.
 * `determineWinner` and `SCREEN_SURVIVAL_THRESHOLD` are exported from
 * `tune.ts` specifically so this file can exercise them without spinning up
 * a real corpus replay.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertNoFutureSeasonLeak,
  assertSelectionPrecedesOrigin,
  buildAcceptanceReport,
  buildJointArtifact,
  buildPairedOriginUnits,
  deriveSelectionSeasons,
  determineWinner,
  evaluationCountForBar,
  loadIncumbent,
  loadSurvivors,
  objectiveForCandidate,
  planJointCandidates,
  resolveJointSelection,
  selectBestScreenRow,
  SCREEN_SURVIVAL_THRESHOLD,
  type ScreenRow,
} from "./tune.js";
import { DEFAULT_SIGMA1_PARAMS, SIGMA1_CODE_VERSION } from "../core/algorithms/sigma1/params.js";
import { isValidParamSet, SEARCHABLE_PARAM_KEYS, SEARCH_EXCLUSIONS } from "./searchSpace.js";
import type { ScoreSlice } from "./score.js";

interface FakeCandidate {
  readonly id: string;
  readonly params: Record<string, number>;
  readonly perSeason: readonly { season: number; brierScore: number | null; winnerAccuracy: number | null }[];
  readonly objective: number;
}

function fakeCandidate(id: string, objective: number): FakeCandidate {
  return {
    id,
    params: { marker: objective },
    perSeason: [{ season: 2022, brierScore: objective, winnerAccuracy: 0.5 }],
    objective,
  };
}

describe("determineWinner", () => {
  it("selects the strictly lowest-objective candidate", () => {
    const results = [fakeCandidate("a", 0.2), fakeCandidate("b", 0.1), fakeCandidate("c", 0.15)];
    const { winnerIndex, ties } = determineWinner(results as any);
    expect(winnerIndex).toBe(1);
    expect(ties).toHaveLength(0);
  });

  it("breaks an exact tie by keeping the earlier-generated candidate, and records the tie", () => {
    const results = [fakeCandidate("a", 0.1), fakeCandidate("b", 0.1), fakeCandidate("c", 0.2)];
    const { winnerIndex, ties } = determineWinner(results as any);
    expect(winnerIndex).toBe(0);
    expect(ties).toHaveLength(1);
    expect(ties[0]!.winnerIndex).toBe(0);
    expect(ties[0]!.tiedIndex).toBe(1);
    expect(ties[0]!.objective).toBe(0.1);
    // Full parameter sets recorded for both sides of the tie.
    expect(ties[0]!.winnerParams).toEqual({ marker: 0.1 });
    expect(ties[0]!.tiedParams).toEqual({ marker: 0.1 });
  });

  it("is deterministic: re-running the same input selects the same winner every time", () => {
    const results = [fakeCandidate("a", 0.3), fakeCandidate("b", 0.1), fakeCandidate("c", 0.1), fakeCandidate("d", 0.05)];
    const first = determineWinner(results as any);
    const second = determineWinner(results as any);
    expect(second.winnerIndex).toBe(first.winnerIndex);
    expect(second.ties).toEqual(first.ties);
    expect(first.winnerIndex).toBe(3);
  });

  it("candidate 0 wins outright when every other candidate is strictly worse", () => {
    const results = [fakeCandidate("default", 0.1), fakeCandidate("worse-1", 0.2), fakeCandidate("worse-2", 0.15)];
    const { winnerIndex } = determineWinner(results as any);
    expect(winnerIndex).toBe(0);
  });
});

describe("SCREEN_SURVIVAL_THRESHOLD", () => {
  it("is a small positive number (a named, justified constant, not a bare literal at the comparison site)", () => {
    expect(SCREEN_SURVIVAL_THRESHOLD).toBeGreaterThan(0);
    expect(SCREEN_SURVIVAL_THRESHOLD).toBeLessThan(0.01);
  });
});

function fakeSlice(algorithmId: string, season: number, brierScore: number, winnerAccuracy: number): ScoreSlice {
  return {
    algorithmId,
    season,
    headlineEligible: false,
    compLevelView: "combined",
    brierScore,
    winnerAccuracy,
    scoredCount: 10,
    tieCount: 0,
    noCallCount: 0,
    exclusionCounts: { offseason: 0, surrogateAffected: 0, missingResult: 0, quarantined: 0 },
    candidateCount: 10,
    calibrationBins: [],
  };
}

describe("D-01: the objective ignores winner accuracy", () => {
  /**
   * Two synthetic slice sets with IDENTICAL brierScore and DRASTICALLY
   * DIFFERENT winnerAccuracy must produce the IDENTICAL objective under
   * `tune.ts`'s own `objectiveForCandidate` (mean brierScore, combined
   * view) — accuracy is recorded in `perSeason` alongside but never enters
   * `objective` (D-01's own must-have truth). This drives the exact
   * function `evaluateCandidateBatch` calls, not a re-derivation of it.
   */
  it("ranks two candidates with equal Brier and wildly different accuracy as equal", () => {
    const slices: ScoreSlice[] = [
      fakeSlice("same-brier-high-accuracy", 2022, 0.17, 0.95),
      fakeSlice("same-brier-low-accuracy", 2022, 0.17, 0.05),
    ];
    const a = objectiveForCandidate(slices, "same-brier-high-accuracy");
    const b = objectiveForCandidate(slices, "same-brier-low-accuracy");
    expect(a.objective).toBe(b.objective);
    expect(a.objective).toBe(0.17);
    // The accuracy values themselves are still recorded in perSeason (never
    // discarded) -- only excluded from `objective`.
    expect(a.perSeason[0]!.winnerAccuracy).toBe(0.95);
    expect(b.perSeason[0]!.winnerAccuracy).toBe(0.05);
  });

});

/**
 * D-T5's four gates (quick task 260901-trz). This is the single edit in that
 * task that can silently re-open hyperparameter-level leakage, so the gates
 * are tested individually and the retired gate's NAME is asserted absent.
 */
describe("assertNoFutureSeasonLeak (D-T5 gate 3)", () => {
  it("throws for a slice AT the boundary season", () => {
    const slices: ScoreSlice[] = [fakeSlice("cand", 2022, 0.1, 0.5), fakeSlice("cand", 2025, 0.1, 0.5)];
    expect(() => assertNoFutureSeasonLeak(slices, 2025)).toThrow(/season 2025/);
    expect(() => assertNoFutureSeasonLeak(slices, 2025)).toThrow(/boundary season 2025/);
  });

  it("throws for a slice AFTER the boundary season", () => {
    const slices: ScoreSlice[] = [fakeSlice("cand", 2026, 0.1, 0.5)];
    expect(() => assertNoFutureSeasonLeak(slices, 2025)).toThrow(/season 2026/);
  });

  it("passes for slices strictly BEFORE the boundary", () => {
    const slices: ScoreSlice[] = [fakeSlice("cand", 2022, 0.1, 0.5), fakeSlice("cand", 2023, 0.12, 0.6), fakeSlice("cand", 2024, 0.13, 0.6)];
    expect(() => assertNoFutureSeasonLeak(slices, 2025)).not.toThrow();
  });

  // The "no longer keys off seasonLabel" regression test that lived here is
  // deleted rather than retargeted (quick task 260903-krp): `seasonLabel` no
  // longer exists on `ScoreSlice` at all, so its claim ("a tune-labelled
  // slice at the boundary is still a leak") has no subject left to guard.
  // The boundary behaviour itself remains covered by "throws for a slice AT
  // the boundary season" above, which asserts the same season-comparison
  // gate without referencing the retired field.

  it("the retired assertNoHoldoutLeak export is GONE, not aliased", async () => {
    // Deleted rather than kept as an alias: leaving both names would let a
    // call site keep the retired predicate by accident, and that predicate
    // passes happily on exactly the leak above.
    const tuneModule = await import("./tune.js");
    expect(Object.keys(tuneModule)).not.toContain("assertNoHoldoutLeak");
  });
});

describe("deriveSelectionSeasons (D-T5 gate 1)", () => {
  const CORPUS = [2022, 2023, 2024, 2025, 2026];

  it("derives strictly-prior seasons for each of the three origins", () => {
    expect(deriveSelectionSeasons(CORPUS, 2024)).toEqual([2022, 2023]);
    expect(deriveSelectionSeasons(CORPUS, 2025)).toEqual([2022, 2023, 2024]);
    expect(deriveSelectionSeasons(CORPUS, 2026)).toEqual([2022, 2023, 2024, 2025]);
  });

  it("never includes the origin season itself", () => {
    for (const origin of [2023, 2024, 2025, 2026]) {
      expect(deriveSelectionSeasons(CORPUS, origin)).not.toContain(origin);
    }
  });

  it("throws for origin 2022 — an empty selection window, named as such", () => {
    expect(() => deriveSelectionSeasons(CORPUS, 2022)).toThrow(/EMPTY selection window/);
    expect(() => deriveSelectionSeasons(CORPUS, 2022)).toThrow(/2022/);
  });

  it("returns a sorted, de-duplicated list regardless of the corpus query's own ordering", () => {
    expect(deriveSelectionSeasons([2024, 2022, 2023, 2022], 2025)).toEqual([2022, 2023, 2024]);
  });
});

describe("assertSelectionPrecedesOrigin (D-T5 gate 2)", () => {
  it("passes when every selection season is strictly prior", () => {
    expect(() => assertSelectionPrecedesOrigin([2022, 2023, 2024], 2025)).not.toThrow();
  });

  it("throws when the latest selection season equals the origin", () => {
    expect(() => assertSelectionPrecedesOrigin([2022, 2025], 2025)).toThrow(/not strictly before origin 2025/);
  });

  it("throws when the latest selection season is after the origin", () => {
    expect(() => assertSelectionPrecedesOrigin([2022, 2026], 2025)).toThrow(/2026/);
  });

  it("throws on an empty selection set", () => {
    expect(() => assertSelectionPrecedesOrigin([], 2025)).toThrow(/empty selection season set/);
  });

  /**
   * T-03-07's "one gate is a convention": the two gates must be INDEPENDENT
   * code paths, so an input that defeats one is still caught by the other. If
   * a single fix silenced both, they would be one gate wearing two names.
   */
  it("fires on an input that DEFEATS gate 1 — the two gates are independent paths", () => {
    // Gate 1 lives inside the derivation and can only ever see what the
    // derivation produced. Gate 2 takes the season list as an ARGUMENT, so it
    // still catches a leaking list handed to it directly — which is exactly
    // what a future refactor that computes the selection set some other way
    // (a hardcoded list, a config file, an operator flag) would produce.
    const leakingListThatSkippedTheDerivation = [2022, 2023, 2024, 2025];
    expect(() => deriveSelectionSeasons([2022, 2023, 2024, 2025, 2026], 2025)).not.toThrow();
    expect(() => assertSelectionPrecedesOrigin(leakingListThatSkippedTheDerivation, 2025)).toThrow(/D-T5 gate 2/);
  });

  it("gate 1 fires on an input that never reaches gate 2", () => {
    // The mirror image: an empty window is rejected by the derivation before
    // gate 2 is ever called, so gate 1 is load-bearing on its own too.
    expect(() => deriveSelectionSeasons([2022], 2022)).toThrow(/EMPTY selection window/);
  });
});

describe("resolveJointSelection (D-T5's --origin / --seasons mutual exclusion)", () => {
  const CORPUS = [2022, 2023, 2024, 2025, 2026];

  it("throws when BOTH --origin and --seasons are given", () => {
    expect(() => resolveJointSelection("2025", "2022,2023", CORPUS)).toThrow(/mutually exclusive/);
    // Two sources of truth for one question -- neither may silently win.
    expect(() => resolveJointSelection("2025", "2022,2023", CORPUS)).toThrow(/two sources\s+of truth|two sources of truth/);
  });

  it("--origin derives the selection seasons and sets the boundary to the origin itself", () => {
    const resolved = resolveJointSelection("2025", undefined, CORPUS);
    expect(resolved.selectionSeasons).toEqual([2022, 2023, 2024]);
    expect(resolved.originSeason).toBe(2025);
    expect(resolved.boundary.season).toBe(2025);
    expect(resolved.boundary.source).toMatch(/rolling-origin/);
  });

  it("--seasons names them explicitly, records origin null, and sets a max+1 boundary that is NOT a blindness guarantee", () => {
    const resolved = resolveJointSelection(undefined, "2022,2023", CORPUS);
    expect(resolved.selectionSeasons).toEqual([2022, 2023]);
    expect(resolved.originSeason).toBeNull();
    expect(resolved.boundary.season).toBe(2024);
    expect(resolved.boundary.source).toMatch(/NOT a forward-blindness guarantee/);
  });

  it("rejects a non-4-digit --origin", () => {
    expect(() => resolveJointSelection("25", undefined, CORPUS)).toThrow(/--origin must be a 4-digit year/);
  });
});

describe("buildJointArtifact (D-T5's recorded discipline)", () => {
  const BASE = {
    adaptationSpec: "off",
    seasons: [2022, 2023, 2024],
    originSeason: 2025,
    boundary: { season: 2025, source: "--origin 2025 (rolling-origin selection, D-T5)" },
    eventsLimit: undefined,
    evalsCount: 40,
    seed: 42,
    batchSize: 4,
    survivorsPath: "reports/sensitivity-screen.json",
    survivors: ["linkC"],
    skipped: null,
    rejectedCandidates: 0,
    ties: [],
    winnerIndex: 0,
    atBound: { linkC: false },
    results: [{ id: "cand-0", params: DEFAULT_SIGMA1_PARAMS, perSeason: [], objective: 0.17 }],
  };

  it("records origin, selectionSeasons and overfittingGuard", () => {
    const artifact = buildJointArtifact(BASE as never);
    expect(artifact["origin"]).toBe(2025);
    expect(artifact["selectionSeasons"]).toEqual([2022, 2023, 2024]);
    expect(artifact["overfittingGuard"]).toBe("rolling-origin (D-T5)");
    expect(artifact["leakBoundarySeason"]).toBe(2025);
  });

  it("carries NO loso key — LOSO was deleted, not skipped", () => {
    // A `loso: { skipped: ... }` key would describe a discipline the tuner no
    // longer practises, which is the stale-artifact failure mode D-T5 removes.
    const artifact = buildJointArtifact(BASE as never);
    expect(artifact).not.toHaveProperty("loso");
    expect(Object.keys(artifact)).not.toContain("loso");
  });

  it("records origin null for a --seasons-mode run", () => {
    const artifact = buildJointArtifact({
      ...BASE,
      originSeason: null,
      boundary: { season: 2024, source: "--seasons 2022,2023 (nothing beyond the requested set; NOT a forward-blindness guarantee)" },
    } as never);
    expect(artifact["origin"]).toBeNull();
    expect(artifact["overfittingGuard"]).toBe("rolling-origin (D-T5)");
  });
});

/**
 * D-T6/D-T7's WIRING (quick task 260901-trz Task 6). The bootstrap itself and
 * the acceptance rule itself are unit-tested in `eventBootstrap.test.ts` and
 * `acceptance.test.ts`; what is tested here is that the tuner hands them the
 * right quantities — the paired SE to the bar, the level SE only to the
 * report, N counted over what was actually evaluated, and a comparison that
 * refuses to proceed unpaired.
 */
describe("evaluationCountForBar (D-T7's N)", () => {
  it("counts candidates ACTUALLY EVALUATED — not --evals, and not the rejected-and-resampled draws", () => {
    // 40 random draws + 18 coordinate-descent refinement candidates = 58
    // evaluated; 6 draws were rejected by isValidParamSet before ever being
    // scored and were therefore never a chance to win by luck.
    expect(evaluationCountForBar(58, 6, 40)).toBe(58);
    expect(evaluationCountForBar(58, 6, 40)).not.toBe(40);
    expect(evaluationCountForBar(58, 6, 40)).not.toBe(64);
  });

  it("throws below 2 evaluated candidates — the union bound at N = 1 is exactly 0, which is not a bar", () => {
    expect(() => evaluationCountForBar(1, 0, 1)).toThrow(/at least 2 evaluated candidates/);
    expect(() => evaluationCountForBar(0, 3, 40)).toThrow(/not a bar/);
  });
});

describe("buildPairedOriginUnits (the paired comparison's precondition)", () => {
  const row = (matchKey: string, eventKey: string, brier: number, absoluteError: number) => ({ matchKey, eventKey, brier, absoluteError });

  it("pairs by matchKey, not by array position", () => {
    const candidate = [row("m1", "e1", 0.1, 5), row("m2", "e1", 0.2, 6)];
    // Deliberately reversed: a positional pairing would silently mis-attribute
    // both matches and still return a plausible-looking number.
    const incumbent = [row("m2", "e1", 0.4, 9), row("m1", "e1", 0.3, 8)];
    const units = buildPairedOriginUnits(candidate as never, incumbent as never);
    expect(units).toHaveLength(2);
    expect(units[0]!.matchKey).toBe("m1");
    expect(units[0]!.candidateBrier).toBe(0.1);
    expect(units[0]!.incumbentBrier).toBe(0.3);
    expect(units[1]!.incumbentAbsoluteError).toBe(9);
  });

  it("throws when the two lists differ in LENGTH", () => {
    const candidate = [row("m1", "e1", 0.1, 5), row("m2", "e1", 0.2, 6)];
    const incumbent = [row("m1", "e1", 0.3, 8)];
    expect(() => buildPairedOriginUnits(candidate as never, incumbent as never)).toThrow(/IDENTICAL match set/);
  });

  it("throws when the two lists differ in MATCH SET at equal length", () => {
    // The subtler failure: same count, different matches. An unpaired
    // difference would still produce a standard error, and that SE would be
    // meaningless while looking entirely normal.
    const candidate = [row("m1", "e1", 0.1, 5), row("m2", "e1", 0.2, 6)];
    const incumbent = [row("m1", "e1", 0.3, 8), row("m3", "e1", 0.4, 9)];
    expect(() => buildPairedOriginUnits(candidate as never, incumbent as never)).toThrow(/"m2" was scored for the candidate but not for/);
  });
});

describe("buildAcceptanceReport (D-T7's three outcomes, as the artifact records them)", () => {
  /**
   * Synthetic paired units with an exactly-known mean difference, so the
   * report's arithmetic is checkable without a corpus. Two events, so the
   * event-blocked bootstrap in the real path would have something to resample;
   * here the SEs are injected directly, which is the point — this test is
   * about the wiring, not about the resampler.
   */
  function units(candidateBrier: number, incumbentBrier: number, candidateMae: number, incumbentMae: number) {
    return [
      { eventKey: "e1", matchKey: "m1", candidateBrier, incumbentBrier, candidateAbsoluteError: candidateMae, incumbentAbsoluteError: incumbentMae },
      { eventKey: "e2", matchKey: "m2", candidateBrier, incumbentBrier, candidateAbsoluteError: candidateMae, incumbentAbsoluteError: incumbentMae },
    ];
  }

  const BASE = {
    originSeason: 2025,
    selectionSeasons: [2022, 2023, 2024],
    incumbentVersionPath: "data/algorithm-versions/vpr@4.0.0+tuned-2026-08.json",
    incumbentVersion: "4.0.0+tuned-2026-08",
    eventCount: 2,
    brierDeltaStandardError: 0.0005,
    brierLevelStandardError: 0.00122,
    maeDeltaStandardError: 0.02,
    evaluationCount: 58,
  };

  it("accept: a comfortable margin with unchanged MAE", () => {
    // Bar at N=58, SE 0.0005 is sqrt(2 ln 58) * 0.0005 ~ 0.00143. Margin 0.01.
    const report = buildAcceptanceReport({ ...BASE, units: units(0.15, 0.16, 20, 20) });
    expect(report.outcome.decision).toBe("accept");
    expect(report.verdict).toMatch(/ACCEPTED/);
    expect(report.candidateBrier).toBeCloseTo(0.15, 12);
    expect(report.incumbentBrier).toBeCloseTo(0.16, 12);
  });

  it("keep-incumbent / below-threshold: a positive but sub-bar margin, reported as a completed search", () => {
    const report = buildAcceptanceReport({ ...BASE, units: units(0.1599, 0.16, 20, 20) });
    expect(report.outcome.decision).toBe("keep-incumbent");
    expect(report.outcome.decision === "keep-incumbent" && report.outcome.reason).toBe("below-threshold");
    expect(report.verdict).toMatch(/INCUMBENT STANDS/);
    // The contract, asserted rather than assumed: this is NOT phrased as a
    // failure, because a search that clears nothing has succeeded.
    expect(report.verdict).toMatch(/completed search, not a failed one/);
  });

  it("keep-incumbent / mae-veto: bar cleared, guardrail tripped, and the reported reason names the VETO", () => {
    // +8% MAE (20 -> 21.6) against a small SE: both halves of the guardrail's
    // AND are satisfied, the shape of the regression that motivated it.
    const report = buildAcceptanceReport({ ...BASE, units: units(0.15, 0.16, 21.6, 20) });
    expect(report.outcome.decision).toBe("keep-incumbent");
    expect(report.outcome.decision === "keep-incumbent" && report.outcome.reason).toBe("mae-veto");
    expect(report.verdict).toMatch(/VETOED/);
    // The report must say the candidate was vetoed on MAE, not the far less
    // useful "nothing was accepted" -- the Brier bar WAS cleared.
    expect(report.verdict).toMatch(/and was cleared/);
  });

  /**
   * The negative-margin path — a candidate genuinely WORSE than the incumbent
   * — was uncovered until this case, and that gap is exactly why a report
   * describing a losing candidate as a winner shipped. `outcome.margin` is
   * SIGNED (`incumbentBrier - candidateBrier`), so the prefix's old
   * directional verb rendered "its winner beat the incumbent by -0.010000":
   * a claim that asserts the opposite of the number beside it. All three
   * cases above feed a POSITIVE margin, so none of them could ever see it.
   */
  it("keep-incumbent / below-threshold with a NEGATIVE margin: the verdict claims no win", () => {
    // Candidate 0.17 vs incumbent 0.16 => margin -0.01, genuinely worse.
    const report = buildAcceptanceReport({ ...BASE, units: units(0.17, 0.16, 20, 20) });
    expect(report.outcome.decision).toBe("keep-incumbent");
    expect(report.outcome.decision === "keep-incumbent" && report.outcome.reason).toBe("below-threshold");
    expect(report.outcome.margin).toBeCloseTo(-0.01, 12);
    expect(report.verdict).toMatch(/INCUMBENT STANDS/);
    // The point of the case: the shared prefix must report the signed number
    // without claiming a side, or every keep-incumbent report reads as a win.
    expect(report.verdict).not.toMatch(/beat the incumbent/);
  });

  it("records evaluationCount, the threshold, and BOTH SEs under distinct, unconfusable names", () => {
    const report = buildAcceptanceReport({ ...BASE, units: units(0.15, 0.16, 20, 20) });
    expect(report.outcome.evaluationCount).toBe(58);
    expect(report.outcome.threshold).toBeCloseTo(Math.sqrt(2 * Math.log(58)) * 0.0005, 12);
    expect(report.brierDeltaStandardError).toBe(0.0005);
    expect(report.brierLevelStandardError).toBe(0.00122);
    // The paired SE is the one the bar was built from; the level SE is
    // reported only. Confusing them is the mistake the distinct names exist to
    // prevent, so assert the bar used the paired one.
    expect(report.outcome.threshold).not.toBeCloseTo(Math.sqrt(2 * Math.log(58)) * 0.00122, 12);
    expect(report.verdict).toMatch(/N = 58/);
  });
});

describe("loadIncumbent (D-T7's bar is against WHAT SHIPS)", () => {
  it("throws by name for a missing version file rather than defaulting", () => {
    expect(() => loadIncumbent(join(tmpdir(), "definitely-not-a-version-file-260901-trz.json"))).toThrow(/does not exist/);
    // The refusal must say WHY, so an operator does not "fix" it by pointing
    // the run at the defaults.
    expect(() => loadIncumbent(join(tmpdir(), "definitely-not-a-version-file-260901-trz.json"))).toThrow(
      /NOT DEFAULT_SIGMA1_PARAMS|Refusing to silently substitute the defaults/
    );
  });

  it("reads the real committed incumbent and builds a module carrying its version", () => {
    // D-2 (quick task 260904-100): `loadIncumbent` now returns a built
    // `AlgorithmModule` (routed through `makeSeasonalSigma1`) rather than a
    // bare `{ params, version }` pair, so the module's own params are no
    // longer directly readable here — D-T3's covShrinkage fix is asserted
    // directly against the committed file's own JSON instead (params.test.ts
    // separately pins DEFAULT_SIGMA1_PARAMS.covShrinkage).
    const incumbent = loadIncumbent();
    // Derived rather than pinned: what this test cares about is that the
    // incumbent read from disk is the one the RUNNING code ships, not that it
    // carries any particular version string. Pinning the literal made it fail on
    // a bump the code handled correctly.
    expect(incumbent.version).toBe(`${SIGMA1_CODE_VERSION}+tuned-2026-08`);
  });

  it("the incumbent's own committed params carry D-T3's covShrinkage fix", () => {
    const raw = JSON.parse(
      readFileSync(join("data", "algorithm-versions", `vpr@${SIGMA1_CODE_VERSION}+tuned-2026-08.json`), "utf8")
    ) as { params?: { covShrinkage?: number } };
    expect(raw.params?.covShrinkage).toBe(0.3);
  });
});

const SOME_SURVIVORS = SEARCHABLE_PARAM_KEYS.slice(0, 4);

describe("planJointCandidates", () => {
  it("zero survivors -> mode 'empty', skipped 'no survivors', one default-only candidate", () => {
    const plan = planJointCandidates([], 60, 42, false);
    expect(plan.mode).toBe("empty");
    expect(plan.skipped).toBe("no survivors");
    expect(plan.candidates).toHaveLength(1);
    expect(plan.candidates[0]!.params).toEqual({ ...DEFAULT_SIGMA1_PARAMS, adaptationEnabled: false, rpMonteCarloDraws: 0 });
  });

  it("one survivor -> mode 'singleton', a one-dimensional sweep (not a random search), always including the default", () => {
    const key = SEARCHABLE_PARAM_KEYS[0]!;
    const plan = planJointCandidates([key], 60, 42, false);
    expect(plan.mode).toBe("singleton");
    expect(plan.skipped).toBeNull();
    expect(plan.candidates.length).toBeGreaterThanOrEqual(3);
    const values = plan.candidates.map((c) => (c.params as unknown as Record<string, number>)[key]!);
    expect(values).toContain(DEFAULT_SIGMA1_PARAMS[key] as number);
  });

  it("2+ survivors -> mode 'random': candidate 0 is always the exact default parameter set", () => {
    const plan = planJointCandidates(SOME_SURVIVORS, 20, 42, false);
    expect(plan.mode).toBe("random");
    expect(plan.candidates).toHaveLength(20);
    expect(plan.candidates[0]!.params).toEqual({ ...DEFAULT_SIGMA1_PARAMS, adaptationEnabled: false, rpMonteCarloDraws: 0 });
  });

  it("every generated candidate satisfies isValidParamSet", () => {
    const plan = planJointCandidates(SOME_SURVIVORS, 30, 7, false);
    for (const candidate of plan.candidates) {
      expect(isValidParamSet(candidate.params)).toBe(true);
    }
  });

  it("candidate generation is reproducible: the same seed produces byte-identical parameter sets across two independent calls", () => {
    const planA = planJointCandidates(SOME_SURVIVORS, 25, 12345, false);
    const planB = planJointCandidates(SOME_SURVIVORS, 25, 12345, false);
    expect(planB.candidates).toEqual(planA.candidates);
  });

  it("a different seed produces a different candidate sequence (proves the seed is actually load-bearing, not ignored)", () => {
    const planA = planJointCandidates(SOME_SURVIVORS, 25, 1, false);
    const planB = planJointCandidates(SOME_SURVIVORS, 25, 2, false);
    expect(planB.candidates).not.toEqual(planA.candidates);
  });

  it("adaptationEnabled is forced identically onto every candidate, survivor or not", () => {
    const planOn = planJointCandidates(SOME_SURVIVORS, 10, 42, true);
    for (const candidate of planOn.candidates) {
      expect(candidate.params.adaptationEnabled).toBe(true);
    }
    const planOff = planJointCandidates(SOME_SURVIVORS, 10, 42, false);
    for (const candidate of planOff.candidates) {
      expect(candidate.params.adaptationEnabled).toBe(false);
    }
  });

  it("every candidate fixes rpMonteCarloDraws to 0 regardless of adaptation mode", () => {
    const plan = planJointCandidates(SOME_SURVIVORS, 10, 42, true);
    for (const candidate of plan.candidates) {
      expect(candidate.params.rpMonteCarloDraws).toBe(0);
    }
  });
});

// D-11 / 03-REVIEW WR-01: the singleton branch (exactly one survivor) used
// to build each candidate via a bare `as Sigma1Params` cast and always
// reported `rejectedCandidates: 0` — 03-REVIEW's own prescribed fix asks for
// per-searchable-key coverage, not just the four keys `SOME_SURVIVORS`
// exercises above.
describe("planJointCandidates singleton mode (D-11 / 03-REVIEW WR-01)", () => {
  it.each(SEARCHABLE_PARAM_KEYS.map((key) => [key] as const))(
    "%s: every generated candidate satisfies the cross-parameter invariants",
    (key) => {
      const plan = planJointCandidates([key], 9, 42, false);
      expect(plan.mode).toBe("singleton");
      expect(plan.candidates.length).toBeGreaterThan(0);
      for (const candidate of plan.candidates) {
        expect(isValidParamSet(candidate.params)).toBe(true);
      }
    }
  );

  it("reports a real rejected-candidate count (not a hardcoded 0) when a grid point violates a cross-parameter invariant", async () => {
    // `screenGridFor` reads `SIGMA1_SEARCH_SPACE` from its OWN module's
    // closure, so overriding just the exported `SIGMA1_SEARCH_SPACE`
    // binding would not change what the real `screenGridFor` computes --
    // `screenGridFor` itself is mocked instead, forced to return a grid
    // containing 0.1 for `adaptationMaxFactor`, which is below
    // DEFAULT_SIGMA1_PARAMS.adaptationMinFactor (0.25) and therefore
    // guaranteed to violate D-11's adaptationMinFactor < adaptationMaxFactor
    // invariant at that one grid point, while the other three points stay
    // valid.
    vi.resetModules();
    vi.doMock("./searchSpace.js", async () => {
      const actual = await vi.importActual<typeof import("./searchSpace.js")>("./searchSpace.js");
      return {
        ...actual,
        screenGridFor: (key: string, valueCount: number) => {
          if (key === "adaptationMaxFactor") return [0.1, 1, 4, 16];
          return actual.screenGridFor(key as any, valueCount);
        },
      };
    });
    try {
      const { planJointCandidates: mockedPlanJointCandidates } = await import("./tune.js");
      const plan = mockedPlanJointCandidates(["adaptationMaxFactor"], 9, 42, false);
      expect(plan.mode).toBe("singleton");
      expect(plan.rejectedCandidates).toBeGreaterThan(0);
      expect(plan.candidates.length).toBe(3);
      for (const candidate of plan.candidates) {
        expect(isValidParamSet(candidate.params)).toBe(true);
      }
    } finally {
      vi.doUnmock("./searchSpace.js");
      vi.resetModules();
    }
  });
});

function screenRow(value: number, brierScore: number, winnerAccuracy: number | null = 0.5): ScreenRow {
  return { value, brierScore, winnerAccuracy };
}

describe("selectBestScreenRow (D-10 / 03-REVIEW WR-02)", () => {
  it("returns the row with the lowest Brier score", () => {
    const rows = [screenRow(1, 0.2), screenRow(2, 0.1), screenRow(3, 0.15)];
    expect(selectBestScreenRow("linkC", rows)).toEqual(screenRow(2, 0.1));
  });

  it("on a tie, returns the first such row (matches the existing strictly-less-than comparison's behavior)", () => {
    const rows = [screenRow(1, 0.1), screenRow(2, 0.1), screenRow(3, 0.2)];
    expect(selectBestScreenRow("linkC", rows)).toEqual(screenRow(1, 0.1));
  });

  it("throws — rather than returning undefined — on an empty row list, naming the parameter key", () => {
    expect(() => selectBestScreenRow("linkC", [])).toThrow(/linkC/);
    // The message must also point the reader at the search space, per
    // WR-02's own prescribed fix.
    expect(() => selectBestScreenRow("linkC", [])).toThrow(/SIGMA1_SEARCH_SPACE/);
  });
});

/**
 * D-T3 (quick task 260901-trz). `loadSurvivors` reads parameter names as
 * STRINGS out of a JSON screen artifact, so it — not the type system — is the
 * real boundary a stale artifact crosses. Two distinct failures with two
 * distinct messages: a key that WAS searchable and is now excluded (the
 * artifact is stale, and the exclusion's own recorded reason says why), and a
 * key that was never a parameter at all (the pre-existing message).
 */
describe("loadSurvivors (D-T3's exclusion enforcement at the artifact boundary)", () => {
  const scratch = mkdtempSync(join(tmpdir(), "tune-survivors-"));

  function survivorsFixture(name: string, survivors: readonly string[]): string {
    const path = join(scratch, `${name}.json`);
    writeFileSync(path, JSON.stringify({ survivors }), "utf8");
    return path;
  }

  it("accepts a survivors list of genuinely searchable keys", () => {
    const path = survivorsFixture("valid", [SEARCHABLE_PARAM_KEYS[0]!, SEARCHABLE_PARAM_KEYS[1]!]);
    expect(loadSurvivors(path)).toEqual([SEARCHABLE_PARAM_KEYS[0], SEARCHABLE_PARAM_KEYS[1]]);
  });

  it("rejects an EXCLUDED key and quotes that key's own recorded reason", () => {
    // `covShrinkage` is the concrete case this task creates: it was a real
    // survivor in the committed `tuned-2026-08` provenance, so a pre-D-T3
    // screen artifact genuinely names it.
    const path = survivorsFixture("excluded", ["covShrinkage"]);
    expect(() => loadSurvivors(path)).toThrow(/covShrinkage/);
    expect(() => loadSurvivors(path)).toThrow(/EXCLUDED from the search space/);
    expect(() => loadSurvivors(path)).toThrow(/numerical safeguard/i);
    expect(() => loadSurvivors(path)).toThrow(/SEARCH_EXCLUSIONS/);
  });

  it("rejects EVERY excluded key with its own reason, not one shared message", () => {
    for (const [key, reason] of Object.entries(SEARCH_EXCLUSIONS)) {
      const path = survivorsFixture(`excluded-${key}`, [key]);
      const firstClause = reason.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(() => loadSurvivors(path)).toThrow(new RegExp(firstClause));
    }
  });

  it("rejects a genuinely UNKNOWN key with the pre-existing message, distinct from the exclusion one", () => {
    const path = survivorsFixture("unknown", ["processNoiseFoo"]);
    expect(() => loadSurvivors(path)).toThrow(/not a SEARCHABLE_PARAM_KEYS member/);
    // Distinctness is the point: an unknown key must NOT be reported as a
    // deliberate exclusion, or a typo would read as a documented decision.
    expect(() => loadSurvivors(path)).not.toThrow(/EXCLUDED from the search space/);
  });
});
