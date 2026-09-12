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
 *     `RpMomentsAccumulator` outside a comment;
 *   - the COMMITTED attribution record and its document must stay in step
 *     even though the code that produced them is gone (09-06 Task 4).
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
import { PUBLISHED_ALGORITHM_IDS } from "../packages/harness/publishedAlgorithms.js";

/**
 * The frozen baselines under `data/baselines/` record the premier algorithm under
 * the id it carried WHEN THE MEASUREMENT RAN. Quick task 260912-ivg renamed the live
 * id to `spr` and deliberately did NOT rewrite those files — they are a
 * record of what was measured and when, and rewriting them would falsify the audit
 * trail the sealed 2016-2022 / 2023-2026 holdout rests on.
 *
 * So the id is resolved on READ, exactly as `publish.test.ts`'s
 * `FROZEN_BASELINE_ALGORITHM_ID_ALIASES` already does. The cross-product pins below
 * stay derived from the LIVE `PUBLISHED_ALGORITHM_IDS` — a newly-published algorithm
 * must still widen them rather than slip past — while a frozen record's older name
 * for the same algorithm resolves to its current one.
 */
const FROZEN_BASELINE_ALGORITHM_ID_ALIASES: Readonly<Record<string, string>> = { bpr: "spr" };
const liveAlgorithmId = (frozenId: string): string => FROZEN_BASELINE_ALGORITHM_ID_ALIASES[frozenId] ?? frozenId;
import { RpCalibrationMeasurementSchema } from "../packages/harness/publish.js";
import {
  assertMarginalArmSliceAllowed,
  buildRpAttributionDigest,
  buildRpCalibrationRecord,
  deriveMarginalArmEligibility,
  parseSeasons,
  RP_DOT_THRESHOLD_DEFAULT,
  RP_MARGINAL_ARM_FORBIDDEN_FROM_SEASON,
  RP_RELIABILITY_BUCKET_EDGES,
  RpAttributionRecordSchema,
  ruleModuleWithMarginalArm,
  SHIPPED_RP_LAYER_LABEL,
  type Observation,
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
  it("constructs SigmaScoutLayer exactly twice — the control layer and the --marginal-arm layer — and BOTH carry a resolved algorithm id as the second argument", () => {
    const matches = [...SOURCE.matchAll(/new SigmaScoutLayer\(/g)];
    // Two, not one: quick task 260912-2uz added the measurement-only
    // negative-binomial arm, which multiplies LAYERS (never replays) off the
    // one walk-forward pass per season. The count is asserted so a THIRD
    // construction — a second replay, or a layer built some other way — has to
    // be justified here rather than appearing silently.
    expect(matches).toHaveLength(2);
    // The second argument is the resolved algorithm id — 09-01's same-scorer
    // fix, and the premise of every figure this script produces. The third
    // argument this site briefly carried (an arm's model config) is gone with
    // the rest of the temporary selectable surface: there is one production
    // model again, and the arm is a variant RULE MODULE rather than a config.
    expect(SOURCE).toMatch(/new SigmaScoutLayer\(ruleModule, \w+\.id\)/);
    expect(SOURCE).toMatch(/new SigmaScoutLayer\(armRuleModule, \w+\.id\)/);
    // Neither construction may be one-argument: that is the exact defect the
    // SAME-SCORER FIX header records, and it once manufactured a phantom
    // ~0.003 regression on this very question.
    expect(SOURCE).not.toMatch(/new SigmaScoutLayer\([A-Za-z]+\)/);
  });

  it("runs exactly one WalkForwardSimulator replay per season — the arms multiply layers, never replays", () => {
    expect([...SOURCE.matchAll(/new WalkForwardSimulator\(/g)]).toHaveLength(1);
    expect([...SOURCE.matchAll(/buildSeasonStream\(/g)]).toHaveLength(1);
  });

  it("scores both arms with the SAME brier helper — no second scoring implementation anywhere in the file", () => {
    // One definition of each scoring helper. A parallel implementation is the
    // failure the SAME-SCORER FIX header exists to prevent.
    expect([...SOURCE.matchAll(/function brier\(/g)]).toHaveLength(1);
    expect([...SOURCE.matchAll(/function rate\(/g)]).toHaveLength(1);
    expect([...SOURCE.matchAll(/function meanPredicted\(/g)]).toHaveLength(1);
  });

  it("reaches RP only through SigmaScoutLayer.foldPlayed — no direct rpPmfForMatch/RpMomentsAccumulator call outside a comment", () => {
    const codeOnly = SOURCE.split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    expect((codeOnly.match(/rpPmfForMatch|RpMomentsAccumulator/g) ?? []).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The committed record and its document, after the code that produced them
// was deleted (09-06 Task 4, D-06)
// ---------------------------------------------------------------------------
//
// The arms, the bar and the ship-decision rule are gone. The record they
// produced is not, and neither is the document that reads it. Everything below
// is pure over the committed JSON and references no deleted symbol — which is
// exactly why the record was schema'd against plain strings rather than
// against the config type in the first place.

const ATTRIBUTION_RAW = JSON.parse(
  readFileSync(new URL("../data/baselines/rp-attribution-2026-09.json", import.meta.url), "utf8")
) as unknown;

describe("data/baselines/rp-attribution-2026-09.json — the committed record outlives its generating code", () => {
  it("still parses through its own schema", () => {
    expect(() => RpAttributionRecordSchema.parse(ATTRIBUTION_RAW)).not.toThrow();
  });

  const record = RpAttributionRecordSchema.parse(ATTRIBUTION_RAW);
  const allCells = [...record.selectionSlice.cells, ...record.reportingSlice.cells];

  it("covers the full cross product of its own arms x published algorithms x registered seasons — one set equality", () => {
    const expected = new Set<string>();
    for (const arm of Object.keys(record.armConfigs)) {
      for (const algorithmId of PUBLISHED_ALGORITHM_IDS) {
        for (const season of Object.keys(RP_RULE_MODULES).map(Number)) {
          expected.add(`${arm}|${algorithmId}|${season}`);
        }
      }
    }
    expect(new Set(allCells.map((c) => `${c.arm}|${liveAlgorithmId(c.algorithmId)}|${c.season}`))).toEqual(expected);
  });

  it("keeps every season's bonuses in the season module's own positional order", () => {
    for (const arm of Object.keys(record.armConfigs)) {
      for (const algorithmId of PUBLISHED_ALGORITHM_IDS) {
        for (const season of Object.keys(RP_RULE_MODULES).map(Number)) {
          const mine = allCells.filter((c) => c.arm === arm && liveAlgorithmId(c.algorithmId) === algorithmId && c.season === season);
          expect(mine.map((c) => c.bonusName)).toEqual([...RP_RULE_MODULES[season]!.bonusNames]);
        }
      }
    }
  });

  it("every arm scored the identical observation set — the population guard, still checkable at rest", () => {
    const byCell = new Map<string, Map<string, number>>();
    for (const c of allCells) {
      const key = `${c.algorithmId}|${c.season}|${c.bonusName}`;
      if (!byCell.has(key)) byCell.set(key, new Map());
      byCell.get(key)!.set(c.arm, c.count);
    }
    for (const [key, byArm] of byCell) {
      expect(new Set(byArm.values()).size, `differing counts for ${key}`).toBe(1);
    }
  });

  it("its two slices partition the registered seasons, and every cell lands in exactly one of them", () => {
    const selection = new Set(record.selectionSlice.seasons);
    const reporting = new Set(record.reportingSlice.seasons);
    for (const s of selection) expect(reporting.has(s)).toBe(false);
    expect(new Set([...selection, ...reporting])).toEqual(new Set(Object.keys(RP_RULE_MODULES).map(Number)));
    for (const c of record.selectionSlice.cells) expect(selection.has(c.season)).toBe(true);
    for (const c of record.reportingSlice.cells) expect(reporting.has(c.season)).toBe(true);
  });

  it("carries the derived reporting-slice cell census — the bar's own unit of account, never hardcoded", () => {
    const scored = record.reportingSlice.cells.filter((c) => c.arm === "control" && c.count > 0);
    const bonusTotal = record.reportingSlice.seasons.reduce((sum, s) => sum + RP_RULE_MODULES[s]!.bonusNames.length, 0);
    expect(scored.length).toBe(bonusTotal * PUBLISHED_ALGORITHM_IDS.length);
  });

  it("records its arms as plain string maps, which is what let it survive the deletion of the type they described", () => {
    for (const config of Object.values(record.armConfigs)) {
      for (const value of Object.values(config)) expect(typeof value).toBe("string");
    }
    expect(record.corpusIdentity.path).toBe("data/corpus.sqlite");
    expect(record.corpusIdentity.sizeBytes).toBeGreaterThan(0);
  });

  it("pins F10's dot threshold without importing it from the web app", () => {
    expect(record.dotThreshold).toBe(RP_DOT_THRESHOLD_DEFAULT);
  });

  it("records that the pre-committed rule accepted nothing — the reason there is one model again", () => {
    // Not a re-derivation: the rule that produced this is deleted. This asserts
    // the committed OUTCOME, which is what the collapse was carried out against.
    expect(record.decision.acceptedFields).toEqual([]);
    expect([...record.decision.revertedFields].sort()).toEqual(["marginal", "tie", "win"]);
  });
});

describe("docs/models/rp-attribution.md cannot drift off the record it describes", () => {
  it("its machine-readable block deep-equals the digest of the committed record", () => {
    const doc = readFileSync(new URL("../docs/models/rp-attribution.md", import.meta.url), "utf8");
    const match = doc.match(/```json\n([\s\S]*?)\n```/);
    expect(match, "docs/models/rp-attribution.md must carry one ```json fenced block").not.toBeNull();
    expect(JSON.parse(match![1]!) as unknown).toEqual(buildRpAttributionDigest(RpAttributionRecordSchema.parse(ATTRIBUTION_RAW)));
  });

  it("keeps D-04's two slices under separate headings, with no season under the wrong one", () => {
    const doc = readFileSync(new URL("../docs/models/rp-attribution.md", import.meta.url), "utf8");
    const record = RpAttributionRecordSchema.parse(ATTRIBUTION_RAW);
    const section = (heading: string): string => {
      const start = doc.indexOf(heading);
      expect(start, `missing heading: ${heading}`).toBeGreaterThan(-1);
      const rest = doc.slice(start + heading.length);
      const end = rest.search(/\n## /);
      return end === -1 ? rest : rest.slice(0, end);
    };
    const selection = section("## SELECTION SLICE");
    const reporting = section("## REPORTING SLICE");
    // Matched as WHOLE TOKENS rather than substrings: a Brier score of
    // 0.202011 contains "2020" and a raw substring check would read that as a
    // selection season leaking into the reporting section.
    const mentionsYear = (text: string, year: number): boolean => new RegExp(`\b${year}\b`).test(text);
    for (const s of record.reportingSlice.seasons) expect(mentionsYear(selection, s), `selection section mentions reporting season ${s}`).toBe(false);
    for (const s of record.selectionSlice.seasons) expect(mentionsYear(reporting, s), `reporting section mentions selection season ${s}`).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THE COLLAPSE WAS A REFACTOR, AND THIS IS THE PROOF (09-06 Task 4, D-06)
// ---------------------------------------------------------------------------

describe("data/baselines/rp-calibration-2026-09b.json — re-emitted from the collapsed single-path code", () => {
  const REEMITTED = RpCalibrationMeasurementSchema.parse(
    JSON.parse(readFileSync(new URL("../data/baselines/rp-calibration-2026-09b.json", import.meta.url), "utf8"))
  );

  it("is per-bonus EXACTLY equal to the chosen arm's pre-collapse figures — `===`, never a tolerance", () => {
    // A tolerance would hide precisely the deletion this gate exists to catch:
    // a branch removed that was still doing something would move a figure by a
    // small amount, and "close enough" would wave it through. If any figure
    // moves, the right response is to find the branch, NOT to widen the
    // comparison or regenerate either file until they agree.
    const record = RpAttributionRecordSchema.parse(ATTRIBUTION_RAW);
    const chosenArm = record.decision.acceptedFields.length === 0 ? "control" : "";
    expect(chosenArm, "the chosen arm must be identifiable from the committed decision").not.toBe("");

    const preCollapse = new Map(
      record.reportingSlice.cells
        .filter((c) => c.arm === chosenArm && c.count > 0)
        .map((c) => [`${c.algorithmId}|${c.season}|${c.bonusName}`, c])
    );

    let compared = 0;
    for (const rec of REEMITTED.records) {
      if (!record.reportingSlice.seasons.includes(rec.season)) continue;
      for (const bonus of rec.calibration.bonuses) {
        const key = `${rec.algorithmId}|${rec.season}|${bonus.name}`;
        const before = preCollapse.get(key);
        expect(before, `no pre-collapse cell for ${key}`).toBeDefined();
        expect(bonus.count, `count moved for ${key}`).toBe(before!.count);
        expect(bonus.meanPredicted, `meanPredicted moved for ${key}`).toBe(before!.meanPredicted);
        expect(bonus.observedFrequency, `observedFrequency moved for ${key}`).toBe(before!.observedFrequency);
        expect(bonus.brierScore, `brierScore moved for ${key}`).toBe(before!.brierScore);
        compared++;
      }
    }
    // The derived census, not a hardcoded 30: a newly-registered season must
    // widen this gate rather than slip past it.
    const bonusTotal = record.reportingSlice.seasons.reduce((sum, s) => sum + RP_RULE_MODULES[s]!.bonusNames.length, 0);
    expect(compared).toBe(bonusTotal * PUBLISHED_ALGORITHM_IDS.length);
  });

  it("covers the full cross product of registered seasons and published algorithms — the same equality pin 09-01 used, re-asserted against the new file", () => {
    const expected = new Set<string>();
    for (const season of Object.keys(RP_RULE_MODULES).map(Number)) {
      for (const algorithmId of PUBLISHED_ALGORITHM_IDS) expected.add(`${season}|${algorithmId}`);
    }
    expect(new Set(REEMITTED.records.map((r) => `${r.season}|${liveAlgorithmId(r.algorithmId)}`))).toEqual(expected);
  });

  it("records the shipped combination as a LABEL, now that the config object that described it is gone (D-05 after D-06)", () => {
    expect(REEMITTED.rpLayer).toBe(SHIPPED_RP_LAYER_LABEL);
  });

  it("09-01's frozen pre-phase measurement is untouched — a re-measurement gets a NEW dated filename so before/after stays a real comparison", () => {
    const frozen = JSON.parse(
      readFileSync(new URL("../data/baselines/rp-calibration-2026-09.json", import.meta.url), "utf8")
    ) as { rpLayer?: string; records: unknown[] };
    // The frozen file predates the label entirely, which is exactly why the
    // schema's new field is optional.
    expect(frozen.rpLayer).toBeUndefined();
    expect(frozen.records.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The measurement-only negative-binomial arm (quick task 260912-2uz)
// ---------------------------------------------------------------------------

describe("--marginal-arm slice guard — the 2023-2026 reporting slice is unspendable", () => {
  for (const season of [2023, 2024, 2025, 2026]) {
    it(`refuses season ${season}`, () => {
      expect(() => assertMarginalArmSliceAllowed([season])).toThrow(/refuses season/);
    });
  }

  it("refuses a RANGE that merely spans the reporting slice rather than silently trimming it — the guard reads the PARSED list, so asking for it is never quietly answered with something else", () => {
    const parsed = parseSeasons("2016-2026");
    // Proves the parse really does carry the forbidden seasons into the guard,
    // rather than the guard being tested against a hand-built array.
    expect(parsed).toContain(2023);
    expect(parsed).toContain(2026);
    expect(() => assertMarginalArmSliceAllowed(parsed)).toThrow(/2023, 2024, 2025, 2026/);
  });

  it("the refusal cites the recorded decision, not just the fact — so nobody reads it as a bug to route around", () => {
    let message = "";
    try {
      assertMarginalArmSliceAllowed([2024]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("2026-09-11");
    expect(message).toContain("2026-09-12");
    expect(message).toContain("SELECTION SLICE");
    expect(message).toMatch(/no override flag/i);
  });

  it("allows the whole selection slice — 2016-2020 plus 2022 — and 2021, which has no rule module and drops out later", () => {
    expect(() => assertMarginalArmSliceAllowed([2016, 2017, 2018, 2019, 2020, 2021, 2022])).not.toThrow();
    expect(() => assertMarginalArmSliceAllowed(parseSeasons("2016-2020,2022"))).not.toThrow();
  });

  it("the forbidden boundary is 2023 — the first season of the reporting slice", () => {
    expect(RP_MARGINAL_ARM_FORBIDDEN_FROM_SEASON).toBe(2023);
    expect(() => assertMarginalArmSliceAllowed([RP_MARGINAL_ARM_FORBIDDEN_FROM_SEASON - 1])).not.toThrow();
    expect(() => assertMarginalArmSliceAllowed([RP_MARGINAL_ARM_FORBIDDEN_FROM_SEASON])).toThrow();
  });

  it("has no override flag anywhere in the source — the prohibition is structural, not a default", () => {
    expect(SOURCE).not.toMatch(/--allow-reporting-slice|--force-slice|--override-slice/);
  });
});

describe("--marginal-arm eligibility partition — derived at runtime from bonusPredicates, never hardcoded", () => {
  it("2018: all three variables eligible, none poisoned, and both bonuses can move", () => {
    const partition = deriveMarginalArmEligibility(RP_RULE_MODULES[2018]!);
    expect(partition.eligible).toEqual(expect.arrayContaining(["autoRunPoints", "autoSwitchOwnershipSec", "endgamePoints"]));
    expect(partition.poisoned).toEqual([]);
    expect(partition.bonusReach.filter((b) => b.canMove).map((b) => b.name)).toEqual(
      expect.arrayContaining(["autoQuest", "faceTheBoss"])
    );
  });

  it("2017: all four fuel/rotor variables poisoned, because each appears in a linearCombination of scaled terms — and so NEITHER bonus can move", () => {
    const partition = deriveMarginalArmEligibility(RP_RULE_MODULES[2017]!);
    expect(partition.poisoned.map((p) => p.name).sort()).toEqual(
      ["autoFuelPoints", "autoRotorPoints", "teleopFuelPoints", "teleopRotorPoints"].sort()
    );
    expect(partition.eligible).toEqual([]);
    expect(partition.bonusReach.every((b) => !b.canMove)).toBe(true);
    for (const b of partition.bonusReach) expect(b.reason).toContain("no clause honours a declared family");
  });

  it("2016: teleopChallengePoints and teleopScalePoints poisoned; the five crossing variables plus attackedTowerEndStrength stay eligible", () => {
    const partition = deriveMarginalArmEligibility(RP_RULE_MODULES[2016]!);
    expect(partition.poisoned.map((p) => p.name).sort()).toEqual(["teleopChallengePoints", "teleopScalePoints"]);
    expect([...partition.eligible].sort()).toEqual(
      [
        "attackedTowerEndStrength",
        "position1crossings",
        "position2crossings",
        "position3crossings",
        "position4crossings",
        "position5crossings",
      ].sort()
    );
    // breach's indicators are all single unscaled terms, so it is FULLY
    // reachable.
    const reach = new Map(partition.bonusReach.map((b) => [b.name, b]));
    expect(reach.get("breach")!.canMove).toBe(true);
    expect(reach.get("breach")!.reason).toContain("every clause");
  });

  it("2016 capture is PARTIALLY reachable, not unreachable — its attackedTowerEndStrength clause honours the declaration while its scaled-sum clause does not", () => {
    // Got wrong first and caught by the measurement's own in-flight
    // consistency check, which reported capture as an "unreachable" cell whose
    // Brier had nonetheless moved. A bonus with one reachable clause and one
    // blocked clause IS reachable; classifying it otherwise understates the
    // arm's reach and buries a real movement in the tie-by-construction
    // category.
    const partition = deriveMarginalArmEligibility(RP_RULE_MODULES[2016]!);
    const capture = partition.bonusReach.find((b) => b.name === "capture")!;
    expect(capture.canMove).toBe(true);
    expect(capture.reason).toContain("PARTIALLY reachable");
    expect(capture.reason).toContain("attackedTowerEndStrength");
    expect(capture.reason).toContain("teleopChallengePoints");
  });

  it("2019: completeRocket is a constant predicate and is reported as structurally inert, never as a cell the family failed to move", () => {
    const partition = deriveMarginalArmEligibility(RP_RULE_MODULES[2019]!);
    const reach = new Map(partition.bonusReach.map((b) => [b.name, b]));
    expect(reach.get("habDocking")!.canMove).toBe(true);
    expect(reach.get("completeRocket")!.canMove).toBe(false);
    expect(reach.get("completeRocket")!.reason).toContain("structurally inert");
  });

  it("2020: endgamePoints eligible and shieldOperational able to move", () => {
    const partition = deriveMarginalArmEligibility(RP_RULE_MODULES[2020]!);
    expect(partition.eligible).toContain("endgamePoints");
    const reach = new Map(partition.bonusReach.map((b) => [b.name, b]));
    expect(reach.get("shieldOperational")!.canMove).toBe(true);
  });

  it("2022: cargoBonus (dataDependentMixture, all three clauses identity) and hangarBonus (singleThreshold) can both move", () => {
    const partition = deriveMarginalArmEligibility(RP_RULE_MODULES[2022]!);
    const reach = new Map(partition.bonusReach.map((b) => [b.name, b]));
    expect(reach.get("cargoBonus")!.canMove).toBe(true);
    expect(reach.get("hangarBonus")!.canMove).toBe(true);
  });

  it("a poisoned variable names WHY it is poisoned — a bare exclusion would read as an arbitrary policy rather than a closure fact", () => {
    const partition = deriveMarginalArmEligibility(RP_RULE_MODULES[2017]!);
    for (const p of partition.poisoned) {
      expect(p.reason).toMatch(/scaled sum|not integer-supported/);
    }
  });
});

describe("--marginal-arm variant rule module (the D-3 seam)", () => {
  it("flips marginalFamily only on eligible variables and leaves poisoned ones declaring gaussian", () => {
    const original = RP_RULE_MODULES[2016]!;
    const partition = deriveMarginalArmEligibility(original);
    const variant = ruleModuleWithMarginalArm(original, partition.eligible);

    const familyByName = new Map(variant.thresholdVariables.map((v) => [v.name, v.marginalFamily]));
    for (const name of partition.eligible) expect(familyByName.get(name)).toBe("negative-binomial");
    for (const p of partition.poisoned) expect(familyByName.get(p.name)).toBe("gaussian");
  });

  it("never mutates the original rule module — production stays all-gaussian", () => {
    const original = RP_RULE_MODULES[2018]!;
    const before = original.thresholdVariables.map((v) => v.marginalFamily);
    ruleModuleWithMarginalArm(original, deriveMarginalArmEligibility(original).eligible);
    expect(original.thresholdVariables.map((v) => v.marginalFamily)).toEqual(before);
    expect(before.every((f) => f === "gaussian")).toBe(true);
  });

  it("every registered season module in the TREE still declares gaussian on every variable — the arm exists only in this script", () => {
    for (const season of Object.keys(RP_RULE_MODULES)) {
      const ruleModule = RP_RULE_MODULES[Number(season)]!;
      for (const v of ruleModule.thresholdVariables) {
        expect(v.marginalFamily, `${season} ${v.name}`).toBe("gaussian");
      }
    }
  });

  it("the variant module evaluates bonuses identically to the original — marginalFamily is a BELIEF declaration and must never change what actually happened", () => {
    const original = RP_RULE_MODULES[2018]!;
    const variant = ruleModuleWithMarginalArm(original, deriveMarginalArmEligibility(original).eligible);
    const values = { autoRunPoints: 10, autoSwitchOwnershipSec: 50, endgamePoints: 60 };
    expect(variant.predictThresholds(values, 0)).toEqual(original.predictThresholds(values, 0));
  });
});
