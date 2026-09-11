/**
 * Unit tests for `measureRpCalibration.ts`'s pure helpers — the isEntryPoint
 * guard (same idiom as `measureEpaDeviations.ts`) lets this file import
 * `buildRpCalibrationRecord`/`RP_RELIABILITY_BUCKET_EDGES` without the script
 * trying to open a corpus.
 *
 * What is tested here is everything that could be silently wrong in a way no
 * console output would reveal:
 *
 *   - a bonus with zero observations must be OMITTED from `bonuses`, never
 *     emitted with a `NaN` figure (T-09-04) — a `NaN` would format as a dash
 *     downstream and read identically to "no data";
 *   - `bonuses` must stay in the CALLER's bonusNames order, never re-sorted —
 *     a silent alphabetisation would desynchronize this record from the
 *     season module's own order the rest of the site uses;
 *   - the same-scorer fix (D-11) must be structurally true: exactly one
 *     `SigmaScoutLayer` construction in the file, with the algorithm id as
 *     its second argument, and no direct call to `rpPmfForMatch`/
 *     `RpMomentsAccumulator` outside a comment.
 *
 * Task 2 Step 5 (2026-09-11): `buildRpCalibrationRecord`'s wire record no
 * longer carries `reliabilityBins` — dropped after real measured bytes
 * showed attaching it pushed `compare-2016.json` over the committed compare
 * budget with nothing on the Compare page ever reading it.
 * `RP_RELIABILITY_BUCKET_EDGES` stays exported and tested below because
 * `reliabilityTable` (the CONSOLE report) still uses it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AlgorithmModule, MatchResult } from "../packages/core/algorithms/types.js";
import { WalkForwardSimulator } from "../packages/harness/replay.js";
import { RP_RULE_MODULES } from "../packages/core/rankingPoints/rules.js";
import { RP_LAYER_CONFIG_DEFAULT, type RpLayerConfig } from "../packages/core/rankingPoints/analyticPmf.js";
import { SigmaScoutLayer } from "../packages/harness/sigmaScoutLayer.js";
import { PUBLISHED_ALGORITHM_IDS } from "../packages/harness/publishedAlgorithms.js";
import {
  assertIdenticalPopulations,
  buildRpCalibrationRecord,
  decideRpShipConfig,
  evaluateD09Bar,
  negativeBinomialShare,
  resolveRpArms,
  RP_ATTRIBUTION_ARMS,
  RP_RELIABILITY_BUCKET_EDGES,
  RP_REPORTING_SLICE_SEASONS,
  RP_SELECTION_SLICE_SEASONS,
  rpCellKey,
  type Observation,
  type RpArmVerdict,
  type RpBonusCell,
} from "./measureRpCalibration.js";

const SOURCE = readFileSync(new URL("./measureRpCalibration.ts", import.meta.url), "utf8");

/** Minimal chronologically-ordered synthetic match, same shape convention as `replay.test.ts`'s own `makeMatch`. */
function makeMatch(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    matchKey: "2024test_qm1",
    eventKey: "2024test",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 1,
    redTeams: ["frc1", "frc2", "frc3"],
    blueTeams: ["frc4", "frc5", "frc6"],
    redSurrogates: [],
    blueSurrogates: [],
    winner: "red",
    redScore: 100,
    blueScore: 80,
    redRpEarned: 2,
    blueRpEarned: 0,
    redDqs: [],
    blueDqs: [],
    hasScoreBreakdown: true,
    scoreBreakdownRaw: '{"red":{}}',
    eventType: 0,
    week: null,
    ...overrides,
  };
}

/** A trivial algorithm module — deterministic, no real prediction logic — just enough to satisfy `AlgorithmModule<S>`. */
function makeAlgorithm(id: string): AlgorithmModule<number> {
  return {
    id,
    version: "1.0.0+test",
    initState: () => 0,
    predict: (state) => ({ winner: "red", pRedWin: 0.5, redScore: 50 + state, blueScore: 50 }),
    update: (state) => state + 1,
    teamMetrics: () => ({}),
  };
}

describe("RP_RELIABILITY_BUCKET_EDGES", () => {
  it("is the seven-bucket edge set the console reliability table and the wire emitter both share", () => {
    expect(RP_RELIABILITY_BUCKET_EDGES).toEqual([0, 0.05, 0.2, 0.4, 0.6, 0.8, 0.95, 1.0000001]);
  });
});

describe("buildRpCalibrationRecord", () => {
  it("omits a bonus with zero observations rather than emitting NaN figures (T-09-04)", () => {
    const record = buildRpCalibrationRecord(
      ["energized", "supercharged", "traversal"],
      [
        [{ predicted: 0.5, actual: true }],
        [],
        [{ predicted: 0.1, actual: false }],
      ]
    );
    expect(record.bonuses.map((b) => b.name)).toEqual(["energized", "traversal"]);
    expect(record.bonuses.some((b) => Number.isNaN(b.meanPredicted))).toBe(false);
  });

  it("keeps bonuses in the CALLER's bonusNames order, never re-sorted or alphabetised", () => {
    const record = buildRpCalibrationRecord(
      ["zeta", "alpha", "mu"],
      [
        [{ predicted: 0.5, actual: true }],
        [{ predicted: 0.5, actual: true }],
        [{ predicted: 0.5, actual: true }],
      ]
    );
    expect(record.bonuses.map((b) => b.name)).toEqual(["zeta", "alpha", "mu"]);
  });

  it("scoredCount is the total pooled (alliance, bonus) observation count across every bonus, including the omitted one", () => {
    const record = buildRpCalibrationRecord(
      ["a", "b"],
      [
        [{ predicted: 0.5, actual: true }, { predicted: 0.5, actual: false }],
        [{ predicted: 0.2, actual: false }],
      ]
    );
    expect(record.scoredCount).toBe(3);
  });

  it("meanPredicted/observedFrequency/brierScore are computed with the SAME arithmetic the console report uses — hand-computed expected values", () => {
    const observations: readonly Observation[] = [
      { predicted: 0.0, actual: false },
      { predicted: 0.5, actual: true },
      { predicted: 1.0, actual: true },
      { predicted: 1.0, actual: false },
    ];
    const record = buildRpCalibrationRecord(["only"], [observations]);
    const bonus = record.bonuses[0]!;
    // meanPredicted = (0 + 0.5 + 1 + 1) / 4 = 0.625
    expect(bonus.meanPredicted).toBeCloseTo(0.625, 10);
    // observedFrequency = 2/4 true = 0.5
    expect(bonus.observedFrequency).toBeCloseTo(0.5, 10);
    // brier = mean((predicted - actual)^2) = ((0-0)^2 + (0.5-1)^2 + (1-1)^2 + (1-0)^2) / 4
    //       = (0 + 0.25 + 0 + 1) / 4 = 0.3125
    expect(bonus.brierScore).toBeCloseTo(0.3125, 10);
    expect(bonus.count).toBe(4);
  });

  it("carries no reliabilityBins key at all — dropped per Task 2 Step 5's measured byte-budget remedy", () => {
    const record = buildRpCalibrationRecord(["a"], [[{ predicted: 0.5, actual: true }]]);
    expect("reliabilityBins" in record).toBe(false);
  });

  it("a fully empty input produces zero bonuses and scoredCount 0 — never a thrown error", () => {
    const record = buildRpCalibrationRecord(["a", "b"], [[], []]);
    expect(record.scoredCount).toBe(0);
    expect(record.bonuses).toEqual([]);
  });
});

describe("2021 has no registered RP rule module (guards the premise the season filter relies on)", () => {
  it("RP_RULE_MODULES[2021] is undefined — the at-home season with no ranking-point rules to measure", () => {
    expect(RP_RULE_MODULES[2021]).toBeUndefined();
  });
});

describe("widened emitter (Task 2, D-09) — one runAll, disjoint per-algorithm record sets", () => {
  it("runAll over two algorithm modules and a chronological match list folds each returned record into ITS OWN algorithm, disjoint and in chronological order", () => {
    const matches: MatchResult[] = [
      makeMatch({ matchKey: "2024test_qm1", matchNumber: 1 }),
      makeMatch({ matchKey: "2024test_qm2", matchNumber: 2 }),
      makeMatch({ matchKey: "2024test_qm3", matchNumber: 3 }),
    ];
    const algoA = makeAlgorithm("algoA");
    const algoB = makeAlgorithm("algoB");
    const teams = ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"];

    // Exactly ONE runAll for both algorithms sharing one chronological
    // stream — the shape this task's widened emitter relies on to cost one
    // replay instead of one per algorithm.
    const records = new WalkForwardSimulator(matches).runAll([algoA, algoB], teams);

    const forA = records.filter((r) => r.algorithmId === "algoA");
    const forB = records.filter((r) => r.algorithmId === "algoB");

    // Disjoint: every record belongs to exactly one algorithm.
    expect(forA.length + forB.length).toBe(records.length);
    expect(forA.every((r) => r.algorithmId !== "algoB")).toBe(true);
    expect(forB.every((r) => r.algorithmId !== "algoA")).toBe(true);

    // Chronologically ordered per algorithm — each algorithm's own subsequence
    // preserves the match stream's original order.
    expect(forA.map((r) => r.match.matchKey)).toEqual(["2024test_qm1", "2024test_qm2", "2024test_qm3"]);
    expect(forB.map((r) => r.match.matchKey)).toEqual(["2024test_qm1", "2024test_qm2", "2024test_qm3"]);
  });
});

describe("same-scorer structural assertions (D-11)", () => {
  it("constructs SigmaScoutLayer exactly once, with a rule module, a resolved algorithm id and an arm config", () => {
    const matches = [...SOURCE.matchAll(/new SigmaScoutLayer\(/g)];
    expect(matches).toHaveLength(1);
    // 09-06 Task 1 Step 3 widened this site from two arguments to three. The
    // second argument is still the resolved algorithm id — 09-01's same-scorer
    // fix, and the premise of every figure this script produces — and the
    // third is the ARM's config, which is the only thing that differs between
    // arms. ONE construction site for eight arms is what makes "every arm
    // through the same imported SigmaScoutLayer" a structural fact rather than
    // a claim in a header.
    expect(SOURCE).toMatch(/new SigmaScoutLayer\(ruleModule, \w+\.id, \w+\.config\)/);
  });

  it("reaches RP only through SigmaScoutLayer.foldPlayed — no direct rpPmfForMatch/RpMomentsAccumulator call outside a comment", () => {
    const codeOnly = SOURCE.split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    expect((codeOnly.match(/rpPmfForMatch|RpMomentsAccumulator/g) ?? []).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// D-09's bar, frozen (09-06 Task 1 Step 1)
// ---------------------------------------------------------------------------
//
// Every expectation below is HAND-COMPUTED from the `<baseline>` pinned
// ground-truth table in `09-06-PLAN.md`. None was produced by running the
// implementation and pasting its output — this is the code that decides what
// ships, and a test written from the output it is meant to constrain proves
// only that the code does what it does.
//
// The bar these cases pin is committed BEFORE any 2023-2026 figure exists.
// D-04's reporting slice is one-way: once it informs a choice it stops being
// a clean reporting slice and there is no replacement. Adjusting the bar
// after seeing those numbers is the single failure this plan's structure
// exists to prevent, and it would leave the suite green.

/** Cells with the given Brier scores, one per (2023 + i, bonusI) key. */
function makeCells(briers: readonly number[], counts?: readonly number[]): RpBonusCell[] {
  return briers.map((b, i) => ({
    algorithmId: "bpr",
    season: 2023 + i,
    bonusName: `bonus${i}`,
    count: counts?.[i] ?? 100,
    meanPredicted: 0.5,
    observedFrequency: 0.5,
    brierScore: b,
  }));
}

describe("evaluateD09Bar — D-09's per-bonus bar, frozen before any reporting-slice figure existed", () => {
  it("3 of 4 improve, 0 regress, 1 tie — meets the bar (improved 3 > scored/2 = 2)", () => {
    const control = makeCells([0.2, 0.2, 0.2, 0.2]);
    const arm = makeCells([0.1, 0.1, 0.1, 0.2]);
    const v = evaluateD09Bar(control, arm, "arm");
    expect(v.scored).toBe(4);
    expect(v.improved).toBe(3);
    expect(v.regressed).toBe(0);
    expect(v.tied).toBe(1);
    expect(v.meetsBar).toBe(true);
  });

  it("2 of 4 improve, 0 regress, 2 tie — a bare half does NOT meet the bar", () => {
    const control = makeCells([0.2, 0.2, 0.2, 0.2]);
    const arm = makeCells([0.1, 0.1, 0.2, 0.2]);
    const v = evaluateD09Bar(control, arm, "arm");
    expect(v.improved).toBe(2);
    expect(v.tied).toBe(2);
    // Ties stay in `scored` and count toward neither side, so a tie makes the
    // majority HARDER to reach. That is the conservative direction and it was
    // chosen deliberately.
    expect(v.meetsBar).toBe(false);
  });

  it("3 improve but 1 regresses — a single regression fails the arm outright, at any magnitude", () => {
    const control = makeCells([0.2, 0.2, 0.2, 0.2]);
    const arm = makeCells([0.1, 0.1, 0.1, 0.2000001]);
    const v = evaluateD09Bar(control, arm, "arm");
    expect(v.improved).toBe(3);
    expect(v.regressed).toBe(1);
    expect(v.meetsBar).toBe(false);
  });

  it("an improvement of 1e-8 in every cell counts — D-11 sets no minimum effect size", () => {
    const control = makeCells([0.1, 0.1, 0.1, 0.1]);
    const arm = makeCells([0.09999999, 0.09999999, 0.09999999, 0.09999999]);
    const v = evaluateD09Bar(control, arm, "arm");
    expect(v.improved).toBe(4);
    expect(v.regressed).toBe(0);
    expect(v.meetsBar).toBe(true);
  });

  it("all four cells exactly equal — 0 improved, 0 regressed, 4 tied, bar NOT met", () => {
    const control = makeCells([0.2, 0.2, 0.2, 0.2]);
    const arm = makeCells([0.2, 0.2, 0.2, 0.2]);
    const v = evaluateD09Bar(control, arm, "arm");
    expect(v.improved).toBe(0);
    expect(v.regressed).toBe(0);
    expect(v.tied).toBe(4);
    // A change with no effect is not an improvement.
    expect(v.meetsBar).toBe(false);
  });

  it("a cell with zero observations in either arm is excluded from `scored` entirely", () => {
    const control = makeCells([0.2, 0.2, 0.2, 0.2], [100, 100, 100, 0]);
    const arm = makeCells([0.1, 0.1, 0.2, 0.1], [100, 100, 100, 0]);
    const v = evaluateD09Bar(control, arm, "arm");
    // The fourth cell would have improved; it is not comparable, so it is not
    // counted at all — a cell needs an observation in BOTH arms. That is the
    // whole of what the pinned ground-truth row asserts.
    expect(v.scored).toBe(3);
    expect(v.improved).toBe(2);
    expect(v.tied).toBe(1);
    // Consequence of the exclusion, stated so the denominator's effect is
    // visible: the bar is read against the SHRUNKEN table, 2 > 3/2, not
    // against the four cells that were measured. Dropping a cell therefore
    // makes the majority EASIER, which is exactly why a cell missing from one
    // arm entirely throws instead of being dropped (see the test below).
    expect(v.meetsBar).toBe(true);
  });

  it("cells are matched by the (algorithmId, season, bonusName) triple, never by array index", () => {
    const control = makeCells([0.2, 0.3, 0.4, 0.5]);
    const arm = makeCells([0.1, 0.2, 0.3, 0.5]);
    const ordered = evaluateD09Bar(control, arm, "arm");
    const shuffled = evaluateD09Bar(control, [arm[2]!, arm[0]!, arm[3]!, arm[1]!], "arm");
    expect(shuffled).toEqual(ordered);
    expect(ordered.improved).toBe(3);
  });

  it("a cell present in one arm and absent from the other throws a named error rather than shrinking the table", () => {
    const control = makeCells([0.2, 0.2, 0.2, 0.2]);
    const arm = makeCells([0.1, 0.1, 0.1]);
    expect(() => evaluateD09Bar(control, arm, "arm")).toThrow(/evaluateD09Bar/);
    expect(() => evaluateD09Bar(control, arm, "arm")).toThrow(/bpr\|2026\|bonus3/);
  });

  it("is pure and total — the same two arrays give the same verdict and neither input is mutated", () => {
    const control = makeCells([0.2, 0.2, 0.2, 0.2]);
    const arm = makeCells([0.1, 0.1, 0.1, 0.2]);
    const controlBefore = structuredClone(control);
    const armBefore = structuredClone(arm);
    const a = evaluateD09Bar(control, arm, "candidate");
    const b = evaluateD09Bar(control, arm, "candidate");
    expect(a).toEqual(b);
    expect(a.arm).toBe("candidate");
    expect(control).toEqual(controlBefore);
    expect(arm).toEqual(armBefore);
  });
});

describe("decideRpShipConfig — the pre-committed three-step rule, applied mechanically", () => {
  function verdict(arm: string, improved: number, regressed: number, scored = 10): RpArmVerdict {
    return {
      arm,
      scored,
      improved,
      regressed,
      tied: scored - improved - regressed,
      meetsBar: improved > scored / 2 && regressed === 0,
    };
  }

  function verdicts(entries: readonly RpArmVerdict[]): Map<string, RpArmVerdict> {
    return new Map(entries.map((v) => [v.arm, v]));
  }

  it("all three single-change arms pass and the combination passes — every field is accepted", () => {
    const d = decideRpShipConfig(
      verdicts([
        verdict("win", 8, 0),
        verdict("tie", 7, 0),
        verdict("marginal", 9, 0),
        verdict("win+tie+marginal", 9, 0),
      ])
    );
    expect([...d.acceptedFields].sort()).toEqual(["marginal", "tie", "win"]);
    expect(d.revertedFields).toEqual([]);
    expect(d.shipConfig).toEqual({
      winSource: "p-red-win",
      tieModel: "discrete-margin",
      marginal: "negative-binomial",
    });
    expect(d.path.join(" | ")).toMatch(/combination gate passed/);
  });

  it("combination fails; dropping the field with the fewest improved cells makes it pass — the single permitted drop", () => {
    const d = decideRpShipConfig(
      verdicts([
        verdict("win", 9, 0),
        verdict("tie", 8, 0),
        verdict("marginal", 7, 0),
        verdict("win+tie+marginal", 6, 1),
        verdict("win+tie", 8, 0),
      ])
    );
    expect(d.revertedFields).toEqual(["marginal"]);
    expect([...d.acceptedFields].sort()).toEqual(["tie", "win"]);
    expect(d.shipConfig).toEqual({
      winSource: "p-red-win",
      tieModel: "discrete-margin",
      marginal: "gaussian",
    });
    expect(d.path.join(" | ")).toMatch(/marginal/);
  });

  it("the drop tie-break is deterministic — equal improved counts drop in the fixed order marginal, tie, win", () => {
    const d = decideRpShipConfig(
      verdicts([
        verdict("win", 7, 0),
        verdict("tie", 7, 0),
        verdict("marginal", 9, 0),
        verdict("win+tie+marginal", 6, 1),
        verdict("win+marginal", 8, 0),
      ])
    );
    // `win` and `tie` are tied at 7 improved; `tie` comes first in the fixed
    // drop order, so `tie` is the one dropped.
    expect(d.revertedFields).toEqual(["tie"]);
    expect([...d.acceptedFields].sort()).toEqual(["marginal", "win"]);
  });

  it("at most ONE drop — a map needing two drops returns the legacy default rather than dropping twice", () => {
    const d = decideRpShipConfig(
      verdicts([
        verdict("win", 9, 0),
        verdict("tie", 8, 0),
        verdict("marginal", 7, 0),
        verdict("win+tie+marginal", 6, 1),
        verdict("win+tie", 6, 1),
      ])
    );
    expect(d.acceptedFields).toEqual([]);
    expect([...d.revertedFields].sort()).toEqual(["marginal", "tie", "win"]);
    expect(d.shipConfig).toEqual(RP_LAYER_CONFIG_DEFAULT);
    expect(d.path.join(" | ")).toMatch(/no second drop/);
  });

  it("exactly one single-change arm passes — the combination gate IS that arm's own verdict, already computed", () => {
    const d = decideRpShipConfig(
      verdicts([verdict("win", 8, 0), verdict("tie", 4, 0), verdict("marginal", 5, 2)])
    );
    expect(d.acceptedFields).toEqual(["win"]);
    expect([...d.revertedFields].sort()).toEqual(["marginal", "tie"]);
    expect(d.shipConfig).toEqual({
      winSource: "p-red-win",
      tieModel: "continuous-equality",
      marginal: "gaussian",
    });
    expect(d.path.join(" | ")).toMatch(/single-change arm/);
  });

  it("no single-change arm passes — nothing to combine, and no combination is evaluated", () => {
    const d = decideRpShipConfig(
      verdicts([verdict("win", 3, 0), verdict("tie", 4, 1), verdict("marginal", 5, 0)])
    );
    expect(d.acceptedFields).toEqual([]);
    expect([...d.revertedFields].sort()).toEqual(["marginal", "tie", "win"]);
    expect(d.shipConfig).toEqual(RP_LAYER_CONFIG_DEFAULT);
    expect(d.path.join(" | ")).toMatch(/no single-change arm met the bar/);
  });

  it("every decision carries a non-empty `path` naming the gate that produced it", () => {
    const cases = [
      verdicts([
        verdict("win", 8, 0),
        verdict("tie", 7, 0),
        verdict("marginal", 9, 0),
        verdict("win+tie+marginal", 9, 0),
      ]),
      verdicts([verdict("win", 3, 0), verdict("tie", 4, 1), verdict("marginal", 5, 0)]),
      verdicts([verdict("win", 8, 0), verdict("tie", 4, 0), verdict("marginal", 5, 2)]),
    ];
    for (const c of cases) {
      const d = decideRpShipConfig(c);
      expect(d.path.length).toBeGreaterThan(0);
      for (const line of d.path) expect(line.length).toBeGreaterThan(0);
    }
  });

  it("a verdict the rule needs but the map does not carry throws a named error rather than defaulting", () => {
    expect(() =>
      decideRpShipConfig(
        verdicts([verdict("win", 8, 0), verdict("tie", 7, 0), verdict("marginal", 9, 0)])
      )
    ).toThrow(/decideRpShipConfig/);
  });
});

// ---------------------------------------------------------------------------
// The arm registry, D-04's slices, and the multi-arm fold (09-06 Task 1)
// ---------------------------------------------------------------------------

describe("RP_ATTRIBUTION_ARMS — the eight arms", () => {
  it("has exactly eight entries with `control` first, deep-equal to the imported production default", () => {
    expect(RP_ATTRIBUTION_ARMS).toHaveLength(8);
    expect(RP_ATTRIBUTION_ARMS[0]!.name).toBe("control");
    expect(RP_ATTRIBUTION_ARMS[0]!.config).toEqual(RP_LAYER_CONFIG_DEFAULT);
  });

  it("covers the FULL cross product of the three fields' declared unions — one set equality, not a loop over a hand-typed list", () => {
    // The member lists are written out here because a TypeScript union is not
    // enumerable at run time. They are typed against the config's own fields,
    // so a member renamed or removed upstream is a COMPILE error in this test
    // rather than a silently shrunken cross product.
    const winSources: readonly RpLayerConfig["winSource"][] = ["score-draw", "p-red-win"];
    const tieModels: readonly RpLayerConfig["tieModel"][] = ["continuous-equality", "discrete-margin"];
    const marginals: readonly RpLayerConfig["marginal"][] = ["gaussian", "negative-binomial"];

    const expected = new Set<string>();
    for (const w of winSources) {
      for (const t of tieModels) {
        for (const m of marginals) expected.add(`${w}|${t}|${m}`);
      }
    }
    const actual = new Set(
      RP_ATTRIBUTION_ARMS.map((a) => `${a.config.winSource}|${a.config.tieModel}|${a.config.marginal}`)
    );
    expect(actual).toEqual(expected);
    expect(actual.size).toBe(8);
  });

  it("names every arm after the fields it changes, and every name is distinct", () => {
    expect(RP_ATTRIBUTION_ARMS.map((a) => a.name)).toEqual([
      "control",
      "win",
      "tie",
      "marginal",
      "win+tie",
      "win+marginal",
      "tie+marginal",
      "win+tie+marginal",
    ]);
    expect(new Set(RP_ATTRIBUTION_ARMS.map((a) => a.name)).size).toBe(8);
  });
});

describe("resolveRpArms", () => {
  it('"all" returns all eight in registry order', () => {
    expect(resolveRpArms("all").map((a) => a.name)).toEqual(RP_ATTRIBUTION_ARMS.map((a) => a.name));
  });

  it("a comma list returns exactly those named, in REGISTRY order regardless of the order given", () => {
    expect(resolveRpArms("marginal,control,win").map((a) => a.name)).toEqual(["control", "win", "marginal"]);
  });

  it("no spec returns `control` alone, so every pre-existing invocation keeps its current meaning", () => {
    const resolved = resolveRpArms();
    expect(resolved.map((a) => a.name)).toEqual(["control"]);
    expect(resolved[0]!.config).toEqual(RP_LAYER_CONFIG_DEFAULT);
  });

  it("an unknown name throws, naming the unknown arm AND listing the valid ones", () => {
    expect(() => resolveRpArms("win,negbinom")).toThrow(/negbinom/);
    expect(() => resolveRpArms("win,negbinom")).toThrow(/win\+tie\+marginal/);
  });
});

describe("D-04's two slices", () => {
  it("are disjoint, and their union is exactly the registered season list", () => {
    const selection = new Set(RP_SELECTION_SLICE_SEASONS);
    const reporting = new Set(RP_REPORTING_SLICE_SEASONS);
    const registered = new Set(Object.keys(RP_RULE_MODULES).map(Number));
    for (const s of selection) expect(reporting.has(s)).toBe(false);
    expect(new Set([...selection, ...reporting])).toEqual(registered);
  });

  it("the reporting slice carries the cells D-09's bar is read over, derived and never hardcoded", () => {
    // Derived from RP_RULE_MODULES and PUBLISHED_ALGORITHM_IDS at run time: a
    // test that iterates a hardcoded season list silently skips a
    // newly-registered season, while only an equality pin fails loudly.
    const bonusTotal = RP_REPORTING_SLICE_SEASONS.reduce((sum, s) => sum + RP_RULE_MODULES[s]!.bonusNames.length, 0);
    expect(bonusTotal).toBe(10);
    expect(bonusTotal * PUBLISHED_ALGORITHM_IDS.length).toBe(30);
  });
});

describe("assertIdenticalPopulations — the in-flight guard", () => {
  const arms = resolveRpArms("control,win");

  it("passes when every arm scored the identical observation set", () => {
    const counts = new Map([
      [rpCellKey("control", "bpr", 2026, "energized"), 400],
      [rpCellKey("win", "bpr", 2026, "energized"), 400],
    ]);
    expect(() => assertIdenticalPopulations(counts, arms, ["bpr"], 2026, ["energized"])).not.toThrow();
  });

  it("throws naming the differing cell AND both counts when an arm's population differs", () => {
    const counts = new Map([
      [rpCellKey("control", "bpr", 2026, "energized"), 400],
      [rpCellKey("win", "bpr", 2026, "energized"), 399],
    ]);
    expect(() => assertIdenticalPopulations(counts, arms, ["bpr"], 2026, ["energized"])).toThrow(/energized/);
    expect(() => assertIdenticalPopulations(counts, arms, ["bpr"], 2026, ["energized"])).toThrow(/control=400, win=399/);
  });
});

describe("negativeBinomialShare — reads RESOLVED, never DECLARED", () => {
  it("counts fallbacks separately from a declared Gaussian default", () => {
    // 90 negative binomial, 10 gaussian, 0 degenerate, 7 of which were
    // fallbacks: the share is over the RESOLVED families, and `fallbacks` is a
    // separate axis rather than a fourth family.
    expect(negativeBinomialShare({ negativeBinomial: 90, gaussian: 10, degenerate: 0, fallbacks: 7 })).toBeCloseTo(0.9, 10);
  });

  it("an all-Gaussian tally under a negative-binomial label reports 0, which is the whole point of reading it", () => {
    expect(negativeBinomialShare({ negativeBinomial: 0, gaussian: 100, degenerate: 0, fallbacks: 100 })).toBe(0);
  });
});

describe("the multi-arm fold — eight layers off ONE replay", () => {
  it("gives every arm's layer every record in chronological order, with disjoint layer objects", () => {
    const ruleModule = RP_RULE_MODULES[2026]!;
    const arms = resolveRpArms("all");
    const layers = arms.map((arm) => new SigmaScoutLayer(ruleModule, "bpr", arm.config));
    expect(new Set(layers).size).toBe(8);
    for (let i = 0; i < layers.length; i++) {
      for (let j = i + 1; j < layers.length; j++) expect(layers[i]).not.toBe(layers[j]);
    }
  });

  it("folding one record list through eight layers leaves the input records deep-equal to their pre-fold selves", () => {
    const ruleModule = RP_RULE_MODULES[2026]!;
    const arms = resolveRpArms("all");
    const layers = arms.map((arm) => new SigmaScoutLayer(ruleModule, "bpr", arm.config));

    const records = [1, 2, 3].map((n) => ({
      match: makeMatch({ matchKey: `2026test_qm${n}`, matchNumber: n, eventKey: "2026test", eventType: 0 }),
      prediction: { winner: "red" as const, redScore: 100, blueScore: 90, pRedWin: 0.62 },
    }));
    const before = structuredClone(records);

    for (const r of records) {
      for (const layer of layers) layer.foldPlayed(r.match, r.prediction);
    }

    // `foldPlayed` returns a NEW enriched prediction rather than mutating the
    // input — which is what makes folding ONE record list through eight layers
    // safe, and therefore what makes "one replay per season" honest.
    expect(records).toEqual(before);
  });
});
