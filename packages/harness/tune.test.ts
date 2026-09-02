/**
 * Pure unit tests over the joint search's own logic (`tune.ts`'s
 * `determineWinner`, candidate generation, and the objective's
 * accuracy-blindness) — no corpus, matching the plan's stated scope.
 * `determineWinner` and `SCREEN_SURVIVAL_THRESHOLD` are exported from
 * `tune.ts` specifically so this file can exercise them without spinning up
 * a real corpus replay.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertNoHoldoutLeak,
  determineWinner,
  loadSurvivors,
  objectiveForCandidate,
  planJointCandidates,
  selectBestScreenRow,
  SCREEN_SURVIVAL_THRESHOLD,
  type ScreenRow,
} from "./tune.js";
import { DEFAULT_SIGMA1_PARAMS } from "../core/algorithms/sigma1/params.js";
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
    seasonLabel: "tune",
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

describe("assertNoHoldoutLeak (T-03-07's gate 3)", () => {
  it("throws when any produced slice is holdout-labelled or headline-eligible", () => {
    const holdoutLabelled = fakeSlice("cand", 2025, 0.1, 0.5);
    const withHoldoutSlice: ScoreSlice[] = [fakeSlice("cand", 2022, 0.1, 0.5), { ...holdoutLabelled, seasonLabel: "holdout" }];
    expect(() => assertNoHoldoutLeak(withHoldoutSlice)).toThrow(/non-tune \/ headline-eligible/);

    const headlineEligibleSlice: ScoreSlice[] = [{ ...fakeSlice("cand", 2022, 0.1, 0.5), headlineEligible: true }];
    expect(() => assertNoHoldoutLeak(headlineEligibleSlice)).toThrow(/non-tune \/ headline-eligible/);
  });

  it("does not throw for a genuinely tune-only, non-headline-eligible slice set", () => {
    const slices: ScoreSlice[] = [fakeSlice("cand", 2022, 0.1, 0.5), fakeSlice("cand", 2023, 0.12, 0.6)];
    expect(() => assertNoHoldoutLeak(slices)).not.toThrow();
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
